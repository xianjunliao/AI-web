Option Explicit

Dim shell, fso, scriptDir, logsDir, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
logsDir = fso.BuildPath(scriptDir, "logs")

If Not fso.FolderExists(logsDir) Then
  fso.CreateFolder logsDir
End If

nodePath = shell.ExpandEnvironmentStrings("%NVM_SYMLINK%")
If nodePath = "%NVM_SYMLINK%" Or Len(nodePath) = 0 Then
  nodePath = "node"
Else
  nodePath = """" & fso.BuildPath(nodePath, "node.exe") & """"
End If

command = "cmd.exe /c cd /d """ & scriptDir & """ && " & nodePath & " server.js >> """ & fso.BuildPath(logsDir, "server.log") & """ 2>> """ & fso.BuildPath(logsDir, "server-error.log") & """ && exit /b 0"

shell.Run command, 0, False
