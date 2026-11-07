$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = '1.0.4314.35'
$expectedHash = '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4'
$work = Join-Path $env:TEMP 'afastech-admin-build-1.0.4314.35'
$package = Join-Path $work 'webview2.zip'
$sdk = Join-Path $work 'sdk'
$payload = Join-Path $work 'payload'
$output = Join-Path $root 'afastech-website\downloads\AfastechSuperAdminSetup.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw '.NET Framework 4 compiler is required.' }
New-Item -ItemType Directory -Force -Path $work, $sdk, $payload, (Split-Path $output) | Out-Null
if (-not (Test-Path $package)) {
  Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg" -OutFile $package
}
if ((Get-FileHash $package -Algorithm SHA256).Hash -ne $expectedHash) { throw 'WebView2 package checksum does not match the pinned build.' }
Expand-Archive -LiteralPath $package -DestinationPath $sdk -Force
$lib = Join-Path $sdk 'lib\net462'
Copy-Item (Join-Path $lib 'Microsoft.Web.WebView2.Core.dll') $payload -Force
Copy-Item (Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll') $payload -Force
Copy-Item (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') $payload -Force
Copy-Item (Join-Path $sdk 'LICENSE.txt') (Join-Path $payload 'WebView2-LICENSE.txt') -Force
Copy-Item (Join-Path $sdk 'NOTICE.txt') (Join-Path $payload 'WebView2-NOTICE.txt') -Force
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile((Join-Path $root 'afastech-website\assets\afastech-crest.jpg'))
try {
  $bitmap = New-Object System.Drawing.Bitmap $image, 128, 128
  try {
    $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    try {
      $stream = [System.IO.File]::Create((Join-Path $payload 'afastech.ico'))
      try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally { $icon.Dispose() }
  } finally { $bitmap.Dispose() }
} finally { $image.Dispose() }
$app = Join-Path $payload 'AfastechSuperAdmin.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$app" "/win32icon:$payload\afastech.ico" `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  "/reference:$lib\Microsoft.Web.WebView2.Core.dll" "/reference:$lib\Microsoft.Web.WebView2.WinForms.dll" `
  (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Application compilation failed.' }
$files = @('AfastechSuperAdmin.exe', 'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'afastech.ico',
  'WebView2-LICENSE.txt', 'WebView2-NOTICE.txt')
$resources = @($files | ForEach-Object { "/resource:$payload\$_,Payload.$_" })
& $compiler /nologo /target:winexe /platform:x64 "/out:$output" "/win32icon:$payload\afastech.ico" `
  /reference:System.dll /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll `
  $resources (Join-Path $PSScriptRoot 'Installer.cs')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
Write-Output "Built $output"
