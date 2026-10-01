' Runs a .cmd file with no window and waits for it (used by the startup task for the launcher,
' so nobody can close it by accident). Usage: wscript run-hidden.vbs "C:\path\start-launcher.cmd"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WScript.Quit sh.Run("cmd /c """ & WScript.Arguments(0) & """", 0, True)
