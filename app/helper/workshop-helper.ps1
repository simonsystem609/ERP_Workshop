param(
    [ValidateSet("server", "pick", "drop")]
    [string]$Mode = "server",
    [string]$ResultPath = "",
    [string]$LockPath = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web

$ErrorActionPreference = "Stop"
$Port = 4799
$HelperVersion = "2026.08.13.1"
$StateDir = Join-Path $env:LOCALAPPDATA "WorkshopERPHelper"
$JobDir = Join-Path $StateDir "jobs"
$DialogTimeoutMinutes = 15

function Ensure-StateDir {
    New-Item -ItemType Directory -Force -Path $JobDir | Out-Null
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Payload
    )
    $json = $Payload | ConvertTo-Json -Compress -Depth 8
    Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
}

function Assert-NetworkPath {
    param([string]$Path)
    $clean = [string]$Path
    if ([string]::IsNullOrWhiteSpace($clean)) {
        throw "Nincs megadva utvonal."
    }
    if ($clean -match '^[cC]:\\') {
        throw "C: meghajton levo helyi fajl nem linkelheto. Masold Y:-ra vagy mas halozati meghajtora."
    }
    if (-not ($clean -match '^[a-zA-Z]:\\' -or $clean.StartsWith('\\'))) {
        throw "Csak meghajto betus vagy UNC utvonal engedelyezett."
    }
    if (-not (Test-Path -LiteralPath $clean)) {
        throw "Az utvonal nem erheto el ezen a PC-n."
    }
    return $clean
}

function Filter-NetworkPaths {
    param([string[]]$Paths)
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($item in $Paths) {
        if ([string]::IsNullOrWhiteSpace($item)) { continue }
        try {
            [void]$result.Add((Assert-NetworkPath -Path $item))
        } catch {
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Workshop ERP helper") | Out-Null
        }
    }
    return $result.ToArray()
}

function New-TopmostOwner {
    $owner = New-Object System.Windows.Forms.Form
    $owner.Text = "Workshop ERP helper"
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.StartPosition = "CenterScreen"
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Opacity = 0
    return $owner
}

function Pick-Files {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Workshop ERP - fajl linkelese"
    $dialog.Multiselect = $true
    $dialog.CheckFileExists = $true
    $dialog.RestoreDirectory = $true
    $dialog.Filter = "Minden fajl (*.*)|*.*"
    if (Test-Path -LiteralPath "Y:\") {
        $dialog.InitialDirectory = "Y:\"
    }

    $owner = New-TopmostOwner
    try {
        $owner.Show()
        $owner.Activate()
        $result = $dialog.ShowDialog($owner)
    } finally {
        $owner.Close()
        $owner.Dispose()
    }

    if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
        return @()
    }
    return Filter-NetworkPaths -Paths $dialog.FileNames
}

function Drop-Files {
    $script:dropPaths = @()
    $script:rawDropPaths = @()
    $script:dropTimedOut = $false

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Workshop ERP - drag & drop link"
    $form.Size = New-Object System.Drawing.Size(520, 260)
    $form.StartPosition = "CenterScreen"
    $form.TopMost = $true
    $form.AllowDrop = $true
    $form.KeyPreview = $true

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Huzd ide a Y: vagy mas halozati meghajton levo fajlokat."
    $label.Dock = "Fill"
    $label.TextAlign = "MiddleCenter"
    $label.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
    $form.Controls.Add($label)

    $button = New-Object System.Windows.Forms.Button
    $button.Text = "Megse"
    $button.Dock = "Bottom"
    $button.Height = 42
    $button.Add_Click({ $form.Close() })
    $form.Controls.Add($button)

    $closeTimer = New-Object System.Windows.Forms.Timer
    $closeTimer.Interval = 250
    $closeTimer.Add_Tick({
        $closeTimer.Stop()
        $form.Close()
    })

    $timeoutTimer = New-Object System.Windows.Forms.Timer
    $timeoutTimer.Interval = [Math]::Max(1, $DialogTimeoutMinutes) * 60 * 1000
    $timeoutTimer.Add_Tick({
        $timeoutTimer.Stop()
        $script:dropTimedOut = $true
        $label.Text = "A drop ablak idotullepes miatt bezar."
        $closeTimer.Start()
    })

    $form.Add_Shown({
        $form.Activate()
        $timeoutTimer.Start()
    })
    $form.Add_KeyDown({
        if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
            $form.Close()
        }
    })
    $form.Add_FormClosed({
        $timeoutTimer.Stop()
        $closeTimer.Stop()
    })
    $form.Add_DragEnter({
        if ($_.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
            $_.Effect = [System.Windows.Forms.DragDropEffects]::Copy
        } else {
            $_.Effect = [System.Windows.Forms.DragDropEffects]::None
        }
    })
    $form.Add_DragOver({
        if ($_.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
            $_.Effect = [System.Windows.Forms.DragDropEffects]::Copy
        } else {
            $_.Effect = [System.Windows.Forms.DragDropEffects]::None
        }
    })
    $form.Add_DragDrop({
        $files = [string[]]$_.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop)
        $script:rawDropPaths = @($files)
        $_.Effect = [System.Windows.Forms.DragDropEffects]::Copy
        $form.AllowDrop = $false
        $button.Enabled = $false
        $label.Text = "Fajlok atveve, linkeles folyamatban..."
        $timeoutTimer.Stop()
        $closeTimer.Start()
    })

    [void]$form.ShowDialog()
    if ($script:dropTimedOut) {
        throw "A drop ablak idotullepes miatt bezart. Probald ujra."
    }
    if ($script:rawDropPaths.Count -gt 0) {
        $script:dropPaths = Filter-NetworkPaths -Paths $script:rawDropPaths
    }
    return $script:dropPaths
}

function Open-Path {
    param([string]$Path)
    $clean = Assert-NetworkPath -Path $Path
    Start-Process -FilePath $clean
}

function Reveal-Path {
    param([string]$Path)
    $clean = Assert-NetworkPath -Path $Path
    if (Test-Path -LiteralPath $clean -PathType Container) {
        Start-Process -FilePath "explorer.exe" -ArgumentList @("`"$clean`"")
    } else {
        Start-Process -FilePath "explorer.exe" -ArgumentList @("/select,`"$clean`"")
    }
}

function Remove-StaleDialogLock {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        $lock = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $pidValue = [int]($lock.pid)
        $started = [DateTime]($lock.startedAt)
        $processAlive = $false
        if ($pidValue -gt 0) {
            $processAlive = [bool](Get-Process -Id $pidValue -ErrorAction SilentlyContinue)
        }
        $tooOld = ((Get-Date) - $started).TotalMinutes -gt $DialogTimeoutMinutes
        if (-not $processAlive -or $tooOld) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
}

function Get-DialogState {
    Ensure-StateDir
    $dialogLock = Join-Path $JobDir "dialog.lock"
    Remove-StaleDialogLock -Path $dialogLock
    if (-not (Test-Path -LiteralPath $dialogLock)) {
        return @{ busy = $false }
    }
    try {
        $lock = Get-Content -LiteralPath $dialogLock -Raw | ConvertFrom-Json
        return @{
            busy = $true
            kind = $lock.kind
            jobId = $lock.jobId
            startedAt = $lock.startedAt
            pid = $lock.pid
        }
    } catch {
        return @{ busy = $true }
    }
}

function Remove-OldJobs {
    Ensure-StateDir
    $cutoff = (Get-Date).AddHours(-2)
    Get-ChildItem -LiteralPath $JobDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

function Start-DialogJob {
    param([string]$Kind)
    Ensure-StateDir
    Remove-OldJobs
    $dialogLock = Join-Path $JobDir "dialog.lock"
    Remove-StaleDialogLock -Path $dialogLock
    if (Test-Path -LiteralPath $dialogLock) {
        throw "Mar nyitva van egy helper tallozo/drop ablak. Zard be azt az ablakot, vagy varj az idotullepesig."
    }

    $jobId = [Guid]::NewGuid().ToString("N")
    $resultFile = Join-Path $JobDir "$jobId.json"
    $scriptPath = if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    $startedAt = (Get-Date).ToString("o")
    Write-JsonFile -Path $resultFile -Payload @{
        pending = $true
        jobId = $jobId
        kind = $Kind
        startedAt = $startedAt
        helperVersion = $HelperVersion
    }
    Write-JsonFile -Path $dialogLock -Payload @{
        pid = 0
        jobId = $jobId
        kind = $Kind
        startedAt = $startedAt
    }

    try {
        $arguments = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-STA",
            "-WindowStyle", "Hidden",
            "-File", $scriptPath,
            "-Mode", $Kind,
            "-ResultPath", $resultFile,
            "-LockPath", $dialogLock
        )
        $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru
        Write-JsonFile -Path $dialogLock -Payload @{
            pid = $process.Id
            jobId = $jobId
            kind = $Kind
            startedAt = $startedAt
        }
    } catch {
        Remove-Item -LiteralPath $dialogLock -Force -ErrorAction SilentlyContinue
        Write-JsonFile -Path $resultFile -Payload @{
            done = $true
            jobId = $jobId
            kind = $Kind
            paths = @()
            error = $_.Exception.Message
            helperVersion = $HelperVersion
        }
        throw
    }

    return @{
        pending = $true
        jobId = $jobId
        kind = $Kind
        helperVersion = $HelperVersion
    }
}

function Complete-DialogJob {
    param(
        [string]$Kind,
        [scriptblock]$Action
    )
    try {
        $paths = @(& $Action)
        Write-JsonFile -Path $ResultPath -Payload @{
            done = $true
            jobId = [System.IO.Path]::GetFileNameWithoutExtension($ResultPath)
            kind = $Kind
            paths = @($paths)
            helperVersion = $HelperVersion
        }
    } catch {
        Write-JsonFile -Path $ResultPath -Payload @{
            done = $true
            jobId = [System.IO.Path]::GetFileNameWithoutExtension($ResultPath)
            kind = $Kind
            paths = @()
            error = $_.Exception.Message
            helperVersion = $HelperVersion
        }
    } finally {
        if (-not [string]::IsNullOrWhiteSpace($LockPath)) {
            Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-JobResult {
    param([string]$JobId)
    if ([string]::IsNullOrWhiteSpace($JobId) -or $JobId -notmatch '^[a-fA-F0-9-]{8,64}$') {
        throw "Ervenytelen helper munka azonosito."
    }
    Ensure-StateDir
    Remove-OldJobs
    $resultFile = Join-Path $JobDir "$JobId.json"
    if (-not (Test-Path -LiteralPath $resultFile)) {
        return @{ pending = $true; jobId = $JobId; helperVersion = $HelperVersion }
    }
    try {
        return Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    } catch {
        throw "A helper munka eredmenye nem olvashato."
    }
}

function Get-StatusText {
    param([int]$Status)
    switch ($Status) {
        200 { "OK" }
        204 { "No Content" }
        400 { "Bad Request" }
        404 { "Not Found" }
        409 { "Conflict" }
        500 { "Internal Server Error" }
        default { "OK" }
    }
}

function Send-Json {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$Status,
        [object]$Payload
    )
    $json = $Payload | ConvertTo-Json -Compress -Depth 8
    $body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $statusText = Get-StatusText -Status $Status
    $headers = "HTTP/1.1 $Status $statusText`r`n" +
        "Content-Type: application/json; charset=utf-8`r`n" +
        "Content-Length: $($body.Length)`r`n" +
        "Access-Control-Allow-Origin: *`r`n" +
        "Access-Control-Allow-Methods: GET, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type`r`n" +
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Cache-Control: no-store`r`n" +
        "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($body, 0, $body.Length)
}

function Send-Empty {
    param([System.Net.Sockets.NetworkStream]$Stream)
    $headers = "HTTP/1.1 204 No Content`r`n" +
        "Access-Control-Allow-Origin: *`r`n" +
        "Access-Control-Allow-Methods: GET, OPTIONS`r`n" +
        "Access-Control-Allow-Headers: Content-Type`r`n" +
        "Access-Control-Allow-Private-Network: true`r`n" +
        "Cache-Control: no-store`r`n" +
        "Connection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($bytes, 0, $bytes.Length)
}

function Handle-Request {
    param([System.Net.Sockets.TcpClient]$Client)
    $Client.ReceiveTimeout = 5000
    $Client.SendTimeout = 15000
    $stream = $Client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { return }
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") { break }
    }

    $parts = $requestLine.Split(" ")
    if ($parts.Count -lt 2) {
        Send-Json -Stream $stream -Status 400 -Payload @{ error = "Hibas helper keres." }
        return
    }
    $method = $parts[0]
    $target = $parts[1]
    if ($method -eq "OPTIONS") {
        Send-Empty -Stream $stream
        return
    }
    $uri = [Uri]("http://127.0.0.1:$Port$target")
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)

    try {
        switch ($uri.AbsolutePath) {
            "/health" {
                $dialog = Get-DialogState
                Send-Json -Stream $stream -Status 200 -Payload @{
                    ok = $true
                    helper = "Workshop ERP"
                    port = $Port
                    version = $HelperVersion
                    dialog = $dialog
                }
            }
            "/pick-file" { Send-Json -Stream $stream -Status 200 -Payload (Start-DialogJob -Kind "pick") }
            "/drop-file" { Send-Json -Stream $stream -Status 200 -Payload (Start-DialogJob -Kind "drop") }
            "/result" { Send-Json -Stream $stream -Status 200 -Payload (Get-JobResult -JobId $query["id"]) }
            "/open" {
                Open-Path -Path $query["path"]
                Send-Json -Stream $stream -Status 200 -Payload @{ ok = $true; helperVersion = $HelperVersion }
            }
            "/reveal" {
                Reveal-Path -Path $query["path"]
                Send-Json -Stream $stream -Status 200 -Payload @{ ok = $true; helperVersion = $HelperVersion }
            }
            default { Send-Json -Stream $stream -Status 404 -Payload @{ error = "Ismeretlen helper utvonal." } }
        }
    } catch {
        $status = 400
        if ($_.Exception.Message -like "Mar nyitva van*") { $status = 409 }
        Send-Json -Stream $stream -Status $status -Payload @{ error = $_.Exception.Message; helperVersion = $HelperVersion }
    }
}

if ($Mode -eq "pick") {
    Complete-DialogJob -Kind "pick" -Action { Pick-Files }
    exit
}

if ($Mode -eq "drop") {
    Complete-DialogJob -Kind "drop" -Action { Drop-Files }
    exit
}

Ensure-StateDir
Remove-OldJobs

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
[System.Windows.Forms.NotifyIcon]$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = "Workshop ERP helper fut a 127.0.0.1:$Port cimen"
$notify.Visible = $true

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            Handle-Request -Client $client
        } finally {
            $client.Close()
        }
    }
} finally {
    $notify.Visible = $false
    $listener.Stop()
}
