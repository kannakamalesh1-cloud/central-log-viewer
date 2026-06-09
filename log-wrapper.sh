#!/bin/bash
# ==============================================================================
# Central Log Viewer - Security Wrapper Script
# ==============================================================================
# This script is intended to be used with the SSH 'command="..."' restriction
# in the ~/.ssh/authorized_keys file on the target server.
#
# Usage in authorized_keys:
# command="/path/to/log-wrapper.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-rsa AAA...
# ==============================================================================

# Reject execution if not run via SSH forced command
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  echo "[SECURITY ERROR] Interactive shell access is disabled. You are only allowed to run predefined commands."
  exit 1
fi

# Parse the original command into an array for robust shifting
read -r -a WORDS <<< "$SSH_ORIGINAL_COMMAND"

# Helper functions to sanitize and validate inputs to prevent shell/command injection
validate_path() {
  local path="$1"
  if [ -z "$path" ]; then
    return
  fi
  if [[ "$path" =~ [\'\"\`\$\;\&\!\|\<\>\(\)] ]]; then
    echo "[SECURITY ERROR] Path contains forbidden characters." >&2
    exit 1
  fi
  if [[ "$path" == *".."* ]]; then
    echo "[SECURITY ERROR] Path traversal detected." >&2
    exit 1
  fi
}

validate_identifier() {
  local id="$1"
  if [ -z "$id" ]; then
    return
  fi
  if [[ "$id" =~ [\'\"\`\$\;\&\!\|\<\>\(\)\ ] ]]; then
    echo "[SECURITY ERROR] Identifier contains forbidden characters." >&2
    exit 1
  fi
}

# If the command starts with the script name, shift the arguments
if [[ "${WORDS[0]}" == *"log-wrapper.sh" ]]; then
  WORDS=("${WORDS[@]:1}")
fi

CMD="${WORDS[0]}"
ARG1="${WORDS[1]}"
ARG2="${WORDS[2]}"
ARG3="${WORDS[3]}"

# ------------------------------------------------------------------------------
# Security Allowlist Routes
# ------------------------------------------------------------------------------
case "$CMD" in

  "discover-sources")
    # Returns a list of available log sources based on type specified in ARG1
    SCAN_TYPE="$ARG1"

    # 1. Docker Containers
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "docker" ]]; then
      if command -v docker &> /dev/null; then
         # Format: docker:name|status
         docker ps -a --format '{{.Names}}|{{.Status}}' | while read -r line; do
           echo "docker:$line"
         done
      fi
    fi

    # 2. Kubernetes Pods
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "k8s" ]]; then
      if command -v kubectl &> /dev/null; then
         # Format: k8s:namespace/name|phase
         timeout 2s kubectl get pods -A --request-timeout=2s -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"|"}{.status.phase}{"\n"}{end}' 2>/dev/null | while read -r line; do
           echo "k8s:$line"
         done
      fi
    fi

    # 3. Nginx Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "nginx" ]]; then
      if [ -d "/var/log/nginx" ]; then
         for log in /var/log/nginx/*.log; do
           [ -e "$log" ] || continue
           STATUS="file"
           # Mark as active only if modified in last 15 mins
           if [ -s "$log" ] && [ -n "$(find "$log" -mmin -15 2>/dev/null)" ]; then
              STATUS="active"
           fi
           echo "nginx:$(basename "$log")|$STATUS"
         done
      fi
    fi

    # 4. Apache Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "apache" ]]; then
      if [ -d "/var/log/apache2" ]; then
         for log in /var/log/apache2/*.log; do
           [ -e "$log" ] || continue
           STATUS="file"
           if [ -s "$log" ] && [ -n "$(find "$log" -mmin -15 2>/dev/null)" ]; then
              STATUS="active"
           fi
           echo "apache:$(basename "$log")|$STATUS"
         done
      fi
    fi
    # 5. Core/System & Service Logs (Dynamic discovery of system, service, and utility log files in /var/log)
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "system" || "$SCAN_TYPE" == "auth" || "$SCAN_TYPE" == "other" || "$SCAN_TYPE" == "php" || "$SCAN_TYPE" == "monitor" ]]; then
       # Gather log files directly in /var/log (excluding rotated/gzipped files)
       # And include the standard non-.log files like syslog, messages, secure, dmesg
       for f in /var/log/*.log /var/log/syslog /var/log/messages /var/log/secure /var/log/dmesg; do
         [ -f "$f" ] || continue
         
         # Skip rotated, compressed, or numerical log extensions (e.g., .log.1, .log.2.gz)
         BASENAME=$(basename "$f")
         [[ "$BASENAME" =~ \.[0-9]+$ || "$BASENAME" =~ \.gz$ || "$BASENAME" =~ \.[0-9]+\.log$ ]] && continue

         STATUS="active"
         if [ -z "$(find "$f" -mmin -15 2>/dev/null)" ]; then STATUS="idle"; fi

         # Categorize dynamically
         if [[ "$BASENAME" == "auth.log" || "$BASENAME" == "secure" || "$BASENAME" == *fail2ban* || "$BASENAME" == *attack-response* ]]; then
            STATUS="security"
            if [ -z "$(find "$f" -mmin -15 2>/dev/null)" ]; then STATUS="idle"; fi
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "auth" ]]; then
               echo "auth:$BASENAME|$STATUS"
            fi
         elif [[ "$BASENAME" == "syslog" || "$BASENAME" == "messages" || "$BASENAME" == "dmesg" || "$BASENAME" == "kern.log" || "$BASENAME" == *cloud-init* || "$BASENAME" == *ubuntu-advantage* ]]; then
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "system" ]]; then
               echo "system:$BASENAME|$STATUS"
            fi
         elif [[ "$BASENAME" == *nginx* ]]; then
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "nginx" ]]; then
               echo "nginx:$BASENAME|$STATUS"
            fi
         elif [[ "$BASENAME" == *apache* ]]; then
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "apache" ]]; then
               echo "apache:$BASENAME|$STATUS"
            fi
         elif [[ "$BASENAME" == *php* ]]; then
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "php" ]]; then
               echo "php:$BASENAME|$STATUS"
            fi
         elif [[ "$BASENAME" == *monitor* || "$BASENAME" == *sender* || "$BASENAME" == *bot* ]]; then
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "monitor" ]]; then
               echo "monitor:$BASENAME|$STATUS"
            fi
         else
            if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "other" ]]; then
               echo "other:$BASENAME|$STATUS"
            fi
         fi
       done
    fi

    # 7. Database Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "database" ]]; then
       # Look for common DB logs recursively up to 2 levels
       find /var/log -maxdepth 3 \( -name "*mysql*" -o -name "*postgres*" -o -name "*redis*" -o -name "*mongodb*" \) -type f 2>/dev/null | while read -r log; do
         STATUS="active"
         if [ -z "$(find "$log" -mmin -15 2>/dev/null)" ]; then STATUS="idle"; fi
         echo "database:$log|$STATUS"
       done
    fi

    # 8. Custom
    if [[ "$SCAN_TYPE" == "custom" ]]; then
       echo "custom:ENTER_CUSTOM_PATH|manual"
    fi
    ;;

  "discover-pod-files")
    # Discovers log files and containers inside a specific Kubernetes pod
    # Usage: discover-pod-files <namespace/podname>
    POD_IDENTIFIER="$ARG1"
    validate_identifier "$POD_IDENTIFIER"

    if [ -z "$POD_IDENTIFIER" ]; then
      echo "[ERROR] No pod identifier provided"
      exit 1
    fi

    if [[ "$POD_IDENTIFIER" == *"/"* ]]; then
      K8S_NS="${POD_IDENTIFIER%%/*}"
      K8S_POD="${POD_IDENTIFIER#*/}"
      NS_FLAG="-n $K8S_NS"
    else
      K8S_POD="$POD_IDENTIFIER"
      K8S_NS="default"
      NS_FLAG=""
    fi

    # 1. Discover all containers inside the pod
    CONTAINERS=$(timeout 3s kubectl get pod "$K8S_POD" $NS_FLAG -o jsonpath='{.spec.containers[*].name}' 2>/dev/null)
    for container in $CONTAINERS; do
      if [ -n "$container" ]; then
        echo "k8s-container:${POD_IDENTIFIER}|${container}|active"

        # Scan this container for log files
        timeout 5s kubectl exec $NS_FLAG "$K8S_POD" -c "$container" -- sh -c \
          'find /var/log /app/logs /app/log /logs /home /tmp /root -maxdepth 4 -name "*.log" -type f 2>/dev/null | head -50' \
          2>/dev/null | while read -r filepath; do
            STATUS="file"
            echo "k8s-file:${POD_IDENTIFIER}|${container}|${filepath}|${STATUS}"
        done
      fi
    done

    # 2. Discover all init containers inside the pod (optional but helpful)
    INIT_CONTAINERS=$(timeout 3s kubectl get pod "$K8S_POD" $NS_FLAG -o jsonpath='{.spec.initContainers[*].name}' 2>/dev/null)
    for container in $INIT_CONTAINERS; do
      if [ -n "$container" ]; then
        echo "k8s-container:${POD_IDENTIFIER}|${container}|init"
      fi
    done
    ;;

  "read-pod-container")
    # Streams a specific container log from inside a Kubernetes pod
    # Usage: read-pod-container <namespace/podname> <container_name> [searchterm]
    POD_IDENTIFIER="$ARG1"
    CONTAINER_NAME="$ARG2"
    SEARCH="$ARG3"
    validate_identifier "$POD_IDENTIFIER"
    validate_identifier "$CONTAINER_NAME"

    if [ -z "$POD_IDENTIFIER" ] || [ -z "$CONTAINER_NAME" ]; then
      echo "[ERROR] Usage: read-pod-container <namespace/podname> <container_name>"
      exit 1
    fi

    if [[ "$POD_IDENTIFIER" == *"/"* ]]; then
      K8S_NS="${POD_IDENTIFIER%%/*}"
      K8S_POD="${POD_IDENTIFIER#*/}"
      NS_FLAG="-n $K8S_NS"
    else
      K8S_POD="$POD_IDENTIFIER"
      NS_FLAG=""
    fi

    if [ -n "$SEARCH" ]; then
      timeout 5s kubectl logs $NS_FLAG -f "$K8S_POD" -c "$CONTAINER_NAME" --tail 200 2>/dev/null | grep --line-buffered -i -e "$SEARCH" --
    else
      timeout 5s kubectl logs $NS_FLAG -f "$K8S_POD" -c "$CONTAINER_NAME" --tail 200 2>/dev/null
    fi
    exit 0
    ;;

  "read-pod-file")
    # Streams a specific log file from inside a Kubernetes pod
    # Usage: read-pod-file <namespace/podname> </path/to/file.log> [--container <container>] [searchterm]
    POD_IDENTIFIER="${WORDS[1]}"
    FILE_PATH="${WORDS[2]}"
    validate_identifier "$POD_IDENTIFIER"
    validate_path "$FILE_PATH"
    CONTAINER_FLAG=""
    SEARCH=""

    # Parse arguments starting from index 3
    for ((i=3; i<${#WORDS[@]}; i++)); do
      if [[ "${WORDS[i]}" == "--container" || "${WORDS[i]}" == "-c" ]]; then
        validate_identifier "${WORDS[i+1]}"
        CONTAINER_FLAG="-c ${WORDS[i+1]}"
        ((i++))
      else
        if [ -z "$SEARCH" ]; then
          SEARCH="${WORDS[i]}"
        else
          SEARCH="$SEARCH ${WORDS[i]}"
        fi
      fi
    done

    if [ -z "$POD_IDENTIFIER" ] || [ -z "$FILE_PATH" ]; then
      echo "[ERROR] Usage: read-pod-file <namespace/podname> </path/to/logfile> [--container <container>] [searchterm]"
      exit 1
    fi

    # Security: block path traversal
    if [[ "$FILE_PATH" == *".."* ]]; then
      echo "[SECURITY ERROR] Path traversal detected."
      exit 1
    fi

    if [[ "$POD_IDENTIFIER" == *"/"* ]]; then
      K8S_NS="${POD_IDENTIFIER%%/*}"
      K8S_POD="${POD_IDENTIFIER#*/}"
      NS_FLAG="-n $K8S_NS"
    else
      K8S_POD="$POD_IDENTIFIER"
      NS_FLAG=""
    fi

    if [ -n "$SEARCH" ]; then
      timeout 5s kubectl exec $NS_FLAG "$K8S_POD" $CONTAINER_FLAG -- sh -c "tail -n 200 -f \"$FILE_PATH\" 2>/dev/null" 2>/dev/null | grep --line-buffered -i -e "$SEARCH" --
    else
      timeout 5s kubectl exec $NS_FLAG "$K8S_POD" $CONTAINER_FLAG -- sh -c "tail -n 200 -f \"$FILE_PATH\" 2>/dev/null" 2>/dev/null
    fi
    exit 0
    ;;

  "discover-container-files")
    # Discovers log files inside a specific Docker container
    # Usage: discover-container-files <container_name>
    CONTAINER_NAME="$ARG1"
    validate_identifier "$CONTAINER_NAME"

    if [ -z "$CONTAINER_NAME" ]; then
      echo "[ERROR] No container name provided"
      exit 1
    fi

    # Find all .log files inside the docker container
    timeout 5s docker exec "$CONTAINER_NAME" sh -c \
      'find /var/log /app/logs /app/log /logs /home /tmp /root -maxdepth 4 -name "*.log" -type f 2>/dev/null | head -50' \
      2>/dev/null | while read -r filepath; do
        STATUS="file"
        echo "docker-file:${CONTAINER_NAME}|${filepath}|${STATUS}"
    done
    ;;

  "read-container-file")
    # Streams a specific log file from inside a Docker container
    # Usage: read-container-file <container_name> </path/to/file.log> [searchterm]
    CONTAINER_NAME="$ARG1"
    FILE_PATH="$ARG2"
    SEARCH="$ARG3"
    validate_identifier "$CONTAINER_NAME"
    validate_path "$FILE_PATH"

    if [ -z "$CONTAINER_NAME" ] || [ -z "$FILE_PATH" ]; then
      echo "[ERROR] Usage: read-container-file <container_name> </path/to/logfile>"
      exit 1
    fi

    # Security: block path traversal
    if [[ "$FILE_PATH" == *".."* ]]; then
      echo "[SECURITY ERROR] Path traversal detected."
      exit 1
    fi

    if [ -n "$SEARCH" ]; then
      timeout 5s docker exec "$CONTAINER_NAME" sh -c "tail -n 200 -f \"$FILE_PATH\" 2>/dev/null" 2>/dev/null | grep --line-buffered -i -e "$SEARCH" --
    else
      timeout 5s docker exec "$CONTAINER_NAME" sh -c "tail -n 200 -f \"$FILE_PATH\" 2>/dev/null" 2>/dev/null
    fi
    exit 0
    ;;

  "read-logs")
    LOG_TYPE="$ARG1"
    LOG_SOURCE="$ARG2"
    validate_identifier "$LOG_TYPE"
    validate_path "$LOG_SOURCE"

    # Defense-in-depth: Block path traversal even if bypassed at the app layer
    if [[ "$LOG_SOURCE" == *".."* ]]; then
      echo "[SECURITY ERROR] Path traversal detected."
      exit 1
    fi

    case "$LOG_TYPE" in
      "system"|"auth"|"php"|"monitor"|"other")
        FILE_PATH="/var/log/$LOG_SOURCE"
        ;;
      "database")
        # For database, the metadata might contain the full path
        if [[ "$LOG_SOURCE" == /* ]]; then
           FILE_PATH="$LOG_SOURCE"
        else
           # Fallback search
           FILE_PATH=$(find /var/log -maxdepth 3 -name "$LOG_SOURCE" -type f 2>/dev/null | head -n 1)
        fi
        ;;
      "nginx")
        FILE_PATH="/var/log/nginx/$LOG_SOURCE"
        ;;
      "apache")
        FILE_PATH="/var/log/apache2/$LOG_SOURCE"
        ;;
      "custom")
        FILE_PATH="$LOG_SOURCE"
        ;;
      "docker")
        # Strip status suffix if present (anything after :)
        CLEAN_DOCKER="${LOG_SOURCE%%:*}"
        validate_identifier "$CLEAN_DOCKER"
        if [ -n "$ARG3" ]; then
          docker logs --tail 200 -f "$CLEAN_DOCKER" 2>&1 | grep --line-buffered -i -e "$ARG3" --
        else
          docker logs --tail 200 -f "$CLEAN_DOCKER" 2>&1
        fi
        exit 0
        ;;
      "k8s")
        if [[ "$LOG_SOURCE" == *"/"* ]]; then
          K8S_NS="${LOG_SOURCE%%/*}"
          K8S_POD_FULL="${LOG_SOURCE#*/}"
          # Strip status suffix if present (anything after :)
          K8S_POD="${K8S_POD_FULL%%:*}"
          validate_identifier "$K8S_NS"
          validate_identifier "$K8S_POD"
          NS_FLAG="-n $K8S_NS"
        else
          K8S_POD="${LOG_SOURCE%%:*}"
          validate_identifier "$K8S_POD"
          NS_FLAG=""
        fi
        if [ -n "$ARG3" ]; then
          kubectl logs $NS_FLAG --tail 200 -f "$K8S_POD" 2>&1 | grep --line-buffered -i -e "$ARG3" --
        else
          kubectl logs $NS_FLAG --tail 200 -f "$K8S_POD" 2>&1
        fi
        exit 0
        ;;
      *)
        echo "[SECURITY ERROR] Unknown log type: $LOG_TYPE"
        exit 1
        ;;
    esac

    # Final execution with permission check
    if [ -f "$FILE_PATH" ]; then
      if [ ! -r "$FILE_PATH" ]; then
         echo -e "\x1b[31m[PERMISSION ERROR]\x1b[0m You don't have read access to $FILE_PATH"
         echo "Try running 'sudo chmod +r $FILE_PATH' on the server."
         exit 1
      fi
      if [ -n "$ARG3" ]; then
        tail -n 200 -f "$FILE_PATH" 2>&1 | grep --line-buffered -i -e "$ARG3" --
      else
        tail -n 200 -f "$FILE_PATH" 2>&1
      fi
    else
      echo -e "\x1b[31m[ERROR]\x1b[0m File not found: $FILE_PATH"
      exit 1
    fi
    ;;

  *)
    # Default case: reject everything else
    echo "[SECURITY ERROR] Command blocked: '$SSH_ORIGINAL_COMMAND'"
    echo "This SSH key is restricted to log viewing only."
    exit 1
    ;;
esac
