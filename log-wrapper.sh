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

# Parse the original command
read -r CMD ARG1 ARG2 ARG3 <<< "$SSH_ORIGINAL_COMMAND"

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
           echo "nginx:$(basename "$log")|file"
         done
      fi
    fi

    # 4. Apache Logs
    if [[ -z "$SCAN_TYPE" || "$SCAN_TYPE" == "apache" ]]; then
      if [ -d "/var/log/apache2" ]; then
         for log in /var/log/apache2/*.log; do
           [ -e "$log" ] || continue
           echo "apache:$(basename "$log")|file"
         done
      fi
    fi
    ;;

  "read-logs")
    LOG_TYPE="$ARG1"
    LOG_SOURCE="$ARG2"

    # Sanitize LOG_SOURCE to prevent command/path injection
    if [[ ! "$LOG_SOURCE" =~ ^[a-zA-Z0-9_\./-]+$ ]]; then
      echo "[SECURITY ERROR] Invalid source name format."
      exit 1
    fi
    
    case "$LOG_TYPE" in
      "nginx")
        # Ensure file exists
        if [ ! -f "/var/log/nginx/$LOG_SOURCE" ]; then exit 1; fi
        if [ -n "$ARG3" ]; then
          tail -n 200 -f "/var/log/nginx/$LOG_SOURCE" | grep --line-buffered -i -e "$ARG3"
        else
          tail -n 200 -f "/var/log/nginx/$LOG_SOURCE"
        fi
        ;;
      "apache")
        if [ ! -f "/var/log/apache2/$LOG_SOURCE" ]; then exit 1; fi
        if [ -n "$ARG3" ]; then
          tail -n 200 -f "/var/log/apache2/$LOG_SOURCE" | grep --line-buffered -i -e "$ARG3"
        else
          tail -n 200 -f "/var/log/apache2/$LOG_SOURCE"
        fi
        ;;
      "docker")
        if [ -n "$ARG3" ]; then
          docker logs --tail 200 -f "$LOG_SOURCE" | grep --line-buffered -i -e "$ARG3"
        else
          docker logs --tail 200 -f "$LOG_SOURCE"
        fi
        ;;
      "k8s")
        # Extract namespace if it exists, otherwise default
        if [[ "$LOG_SOURCE" == *"/"* ]]; then
          K8S_NS="${LOG_SOURCE%%/*}"
          K8S_POD="${LOG_SOURCE#*/}"
          NS_FLAG="-n $K8S_NS"
        else
          K8S_POD="$LOG_SOURCE"
          NS_FLAG=""
        fi

        if [ -n "$ARG3" ]; then
          kubectl logs $NS_FLAG --tail 200 -f "$K8S_POD" | grep --line-buffered -i -e "$ARG3"
        else
          kubectl logs $NS_FLAG --tail 200 -f "$K8S_POD"
        fi
        ;;
      *)
        echo "[SECURITY ERROR] Unknown log type: $LOG_TYPE"
        exit 1
        ;;
    esac
    ;;

  *)
    # Default case: reject everything else
    echo "[SECURITY ERROR] Command blocked: '$SSH_ORIGINAL_COMMAND'"
    echo "This SSH key is restricted to log viewing only."
    exit 1
    ;;
esac
