# Registers a Windows scheduled task that starts the Ricotta transfer worker whenever this
# user signs in. The worker needs the signed-in desktop because it drives a visible Edge window.
# start-worker.cmd restarts the worker if it crashes; the worker's lock file prevents duplicates.
# Run once from this folder:  powershell -ExecutionPolicy Bypass -File .\install-startup-task.ps1
# Remove with:                Unregister-ScheduledTask -TaskName 'Ricotta Transfer Worker' -Confirm:$false
$ErrorActionPreference = 'Stop'
$name = 'Ricotta Transfer Worker'
$cmd = Join-Path $PSScriptRoot 'start-worker.cmd'
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$cmd`" scheduled`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$name'. It starts at your next sign-in. To start it now: Start-ScheduledTask -TaskName '$name'"
Write-Host "It uses ALLOW_SUBMIT from worker\.env. Registering this task does not enable live submission."
