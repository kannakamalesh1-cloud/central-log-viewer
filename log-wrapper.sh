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
    # 5. System Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "system" ]]; then
       # Direct check for most common files
       for f in /var/log/syslog /var/log/messages /var/log/kern.log /var/log/dmesg; do
         if [ -f "$f" ]; then
            STATUS="active"
            if [ -z "$(find "$f" -mmin -15 2>/dev/null)" ]; then STATUS="idle"; fi
            echo "system:$(basename "$f")|$STATUS"
         fi
       done
    fi

    # 6. Auth Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "auth" ]]; then
       for f in /var/log/auth.log /var/log/secure; do
         if [ -f "$f" ]; then
            STATUS="security"
            if [ -z "$(find "$f" -mmin -15 2>/dev/null)" ]; then STATUS="idle"; fi
            echo "auth:$(basename "$f")|$STATUS"
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

  "read-logs")
    LOG_TYPE="$ARG1"
    LOG_SOURCE="$ARG2"

    # Defense-in-depth: Block path traversal even if bypassed at the app layer
    if [[ "$LOG_SOURCE" == *".."* ]]; then
      echo "[SECURITY ERROR] Path traversal detected."
      exit 1
    fi

    case "$LOG_TYPE" in
      "system"|"auth")
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
          NS_FLAG="-n $K8S_NS"
        else
          K8S_POD="${LOG_SOURCE%%:*}"
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
