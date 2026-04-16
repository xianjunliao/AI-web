Option Explicit

Const FALLBACK_PROJECT_ROOT = "e:\works\project\AI-web"
Const PROJECT_ROOT_ENV_NAME = "AI_WEB_PROJECT_ROOT"

Dim shell, fso, scriptDir, projectRoot, batPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = ResolveProjectRoot(scriptDir)

If Len(projectRoot) = 0 Then
  MsgBox "Cannot find the AI-web project root." & vbCrLf & vbCrLf & _
    "Resolution options:" & vbCrLf & _
    "1. Keep this script inside the project's scripts folder" & vbCrLf & _
    "2. Set environment variable " & PROJECT_ROOT_ENV_NAME & vbCrLf & _
    "3. Update FALLBACK_PROJECT_ROOT in this script", vbCritical, "start-local-ai-chat"
  WScript.Quit 1
End If

batPath = fso.BuildPath(projectRoot, "scripts\start-local-ai-chat.bat")
If Not fso.FileExists(batPath) Then
  MsgBox "Launcher batch file not found:" & vbCrLf & batPath, vbCritical, "start-local-ai-chat"
  WScript.Quit 1
End If

If HasArgument("--dry-run") Then
  WScript.Echo "projectRoot=" & projectRoot
  WScript.Echo "batPath=" & batPath
  WScript.Quit 0
End If

shell.CurrentDirectory = projectRoot
shell.Run Quote(batPath), 0, False

Function ResolveProjectRoot(currentScriptDir)
  Dim candidates, envRoot, i, candidate
  envRoot = Trim(shell.ExpandEnvironmentStrings("%" & PROJECT_ROOT_ENV_NAME & "%"))
  candidates = Array( _
    currentScriptDir, _
    fso.GetParentFolderName(currentScriptDir), _
    envRoot, _
    FALLBACK_PROJECT_ROOT _
  )

  For i = 0 To UBound(candidates)
    candidate = NormalizePath(candidates(i))
    If Len(candidate) > 0 Then
      If IsProjectRoot(candidate) Then
        ResolveProjectRoot = candidate
        Exit Function
      End If
    End If
  Next

  ResolveProjectRoot = ""
End Function

Function IsProjectRoot(candidatePath)
  If Len(candidatePath) = 0 Then
    IsProjectRoot = False
    Exit Function
  End If

  IsProjectRoot = _
    fso.FolderExists(candidatePath) And _
    fso.FileExists(fso.BuildPath(candidatePath, "server.js")) And _
    fso.FileExists(fso.BuildPath(candidatePath, "scripts\start-local-ai-chat.bat"))
End Function

Function NormalizePath(rawPath)
  Dim value
  value = Trim(CStr(rawPath))
  If Len(value) = 0 Then
    NormalizePath = ""
    Exit Function
  End If

  If Left(value, 1) = """" And Right(value, 1) = """" Then
    value = Mid(value, 2, Len(value) - 2)
  End If

  If InStr(value, "%") > 0 Then
    NormalizePath = ""
    Exit Function
  End If

  On Error Resume Next
  NormalizePath = fso.GetAbsolutePathName(value)
  If Err.Number <> 0 Then
    NormalizePath = ""
    Err.Clear
  End If
  On Error GoTo 0
End Function

Function HasArgument(expected)
  Dim i
  For i = 0 To WScript.Arguments.Count - 1
    If LCase(Trim(WScript.Arguments(i))) = LCase(expected) Then
      HasArgument = True
      Exit Function
    End If
  Next
  HasArgument = False
End Function

Function Quote(value)
  Quote = """" & CStr(value) & """"
End Function
