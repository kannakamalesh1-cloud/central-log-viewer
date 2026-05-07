# ==============================================================================
# PulseLog Windows Security Wrapper (PowerShell)
# ==============================================================================
# This script replicates the functionality of log-wrapper.sh for Windows hosts.
# 
# Usage in Windows OpenSSH authorized_keys:
# command="powershell.exe -ExecutionPolicy Bypass -File C:\path\to\log-wrapper.ps1",no-port-forwarding... ssh-rsa AAA...
# ==============================================================================

$SSH_ORIGINAL_COMMAND = $env:SSH_ORIGINAL_COMMAND
if (-not $SSH_ORIGINAL_COMMAND) {
    Write-Host "[SECURITY ERROR] Interactive shell access is disabled."
    exit 1
}

# Parse command (Simple split, assumes no spaces in paths for now)
$parts = $SSH_ORIGINAL_COMMAND -split '\s+'
if ($parts[0] -like "*log-wrapper.ps1") { $parts = $parts[1..($parts.Length-1)] }

$CMD  = $parts[0]
$ARG1 = $parts[1] # type
$ARG2 = $parts[2] # identifier/path
$ARG3 = $parts[3] # search term

switch ($CMD) {
    "discover-sources" {
        $SCAN_TYPE = $ARG1

        # 1. Windows Event Logs (mapped to 'system' type)
        if (-not $SCAN_TYPE -or $SCAN_TYPE -eq "system") {
            foreach ($log in @("System", "Application", "Security")) {
                Write-Host "system:$log|active"
            }
        }

        # 2. IIS Logs
        if (-not $SCAN_TYPE -or $SCAN_TYPE -eq "iis" -or $SCAN_TYPE -eq "nginx") {
            $iisPath = "C:\inetpub\logs\LogFiles"
            if (Test-Path $iisPath) {
                Get-ChildItem -Path $iisPath -Recurse -Filter "*.log" | ForEach-Object {
                    $status = "file"
                    if ($_.LastWriteTime -gt (Get-Date).AddMinutes(-30)) { $status = "active" }
                    # Format as iis:path|status
                    Write-Host "iis:$($_.FullName)|$status"
                }
            }
        }

        # 3. Docker Containers (Windows)
        if (-not $SCAN_TYPE -or $SCAN_TYPE -eq "docker") {
            if (Get-Command "docker" -ErrorAction SilentlyContinue) {
                docker ps -a --format "{{.Names}}|{{.Status}}" | ForEach-Object {
                    Write-Host "docker:$_"
                }
            }
        }
        
        # 4. Custom Logs
        if ($SCAN_TYPE -eq "custom") {
            Write-Host "custom:C:\path\to\log.txt|manual"
        }
    }

    "read-logs" {
        $LOG_TYPE   = $ARG1
        $LOG_SOURCE = $ARG2

        if ($LOG_SOURCE -like "*..*") {
            Write-Host "[SECURITY ERROR] Path traversal detected."
            exit 1
        }

        switch ($LOG_TYPE) {
            "system" {
                # Read last 100 events. 
                # Real-time streaming for Event Logs is complex in PS, so we provide a snapshot.
                Get-EventLog -LogName $LOG_SOURCE -Newest 100 | Sort-Object TimeGenerated | ForEach-Object {
                    Write-Host "[$($_.TimeGenerated.ToString('HH:mm:ss'))] [$($_.EntryType)] $($_.Source): $($_.Message -replace "`r`n"," ")"
                }
                exit 0
            }

            "docker" {
                $CLEAN_DOCKER = $LOG_SOURCE.Split('|')[0]
                if ($ARG3) {
                    docker logs --tail 200 -f $CLEAN_DOCKER 2>&1 | Select-String -Pattern $ARG3
                } else {
                    docker logs --tail 200 -f $CLEAN_DOCKER 2>&1
                }
                exit 0
            }

            Default {
                # Assume it's a file path (IIS, Custom, etc)
                if (Test-Path $LOG_SOURCE) {
                    if ($ARG3) {
                        Get-Content -Path $LOG_SOURCE -Tail 200 -Wait | Select-String -Pattern $ARG3
                    } else {
                        Get-Content -Path $LOG_SOURCE -Tail 200 -Wait
                    }
                } else {
                    Write-Host "[ERROR] File not found: $LOG_SOURCE"
                    exit 1
                }
            }
        }
    }

    Default {
        Write-Host "[SECURITY ERROR] Command blocked: '$SSH_ORIGINAL_COMMAND'"
        exit 1
    }
}
