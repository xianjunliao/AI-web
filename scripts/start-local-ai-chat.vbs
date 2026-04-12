Option Explicit

Dim shell, fso, scriptDir, projectRoot, logsDir, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(scriptDir)
logsDir = fso.BuildPath(projectRoot, "logs")

If Not fso.FolderExists(logsDir) Then
  fso.CreateFolder logsDir
End If

nodePath = shell.ExpandEnvironmentStrings("%NVM_SYMLINK%")
If nodePath = "%NVM_SYMLINK%" Or Len(nodePath) = 0 Then
  nodePath = "node"
Else
  nodePath = """" & fso.BuildPath(nodePath, "node.exe") & """"
End If

shell.CurrentDirectory = projectRoot
command = nodePath & " server.js"
shell.Run command, 0, False

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""scripts\skill-runner.ps1"""
shell.Run command, 0, False
