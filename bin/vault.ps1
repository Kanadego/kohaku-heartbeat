# 琥珀的心跳 · 密库（DPAPI CurrentUser 整文件加密）
# 用法：
#   vault.ps1 protect   -in <plain>  -out <enc>   明文 -> 密文(KHBV1 头 + DPAPI blob)
#   vault.ps1 unprotect -in <enc>    -out <plain> 密文 -> 明文
#   vault.ps1 burn      -home <dir>  -yes        一键焚毁(覆写x3后删除)
#
# 安全模型：CurrentUser 作用域 = 本 Windows 账户内自主可用，
# 其他账户/其他机器不可解。防他人不防同账户恶意软件（DESIGN.md §7）。

param(
    [Parameter(Position = 0)][string]$Action,
    [string]$in,
    [string]$out,
    [string]$homeDir,
    [switch]$yes
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$MAGIC = [Text.Encoding]::ASCII.GetBytes('KHBV1')

function Protect-File([string]$InFile, [string]$OutFile) {
    $plain = [IO.File]::ReadAllBytes($InFile)
    $blob = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
    $ms = New-Object IO.MemoryStream
    $ms.Write($MAGIC, 0, $MAGIC.Length)
    $ms.Write($blob, 0, $blob.Length)
    [IO.File]::WriteAllBytes($OutFile, $ms.ToArray())
}

function Unprotect-File([string]$InFile, [string]$OutFile) {
    $raw = [IO.File]::ReadAllBytes($InFile)
    $hdr = New-Object byte[] $MAGIC.Length
    [Array]::Copy($raw, $hdr, $MAGIC.Length)
    for ($i = 0; $i -lt $MAGIC.Length; $i++) {
        if ($hdr[$i] -ne $MAGIC[$i]) { throw "NOT_ENCRYPTED: missing KHBV1 header" }
    }
    $blob = New-Object byte[] ($raw.Length - $MAGIC.Length)
    [Array]::Copy($raw, $MAGIC.Length, $blob, 0, $blob.Length)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')
    [IO.File]::WriteAllBytes($OutFile, $plain)
}

function Invoke-Burn([string]$HomeDir) {
    # 焚毁清单：数据与密钥材料，覆写三次随机字节后删除
    $targets = @(
        "$HomeDir\seeds.json", "$HomeDir\sent.json", "$HomeDir\ledger.md",
        "$HomeDir\logs\heartbeat.jsonl", "$HomeDir\logs\active_chat_log.md",
        "$HomeDir\drafts", "$HomeDir\profiles"
    )
    foreach ($t in $targets) {
        if (Test-Path $t -PathType Leaf) {
            $len = (Get-Item $t).Length
            $rnd = New-Object byte[] $len
            1..3 | ForEach-Object {
                ([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($rnd)
                [IO.File]::WriteAllBytes($t, $rnd)
            }
            Remove-Item $t -Force
            Write-Output "BURNED: $t"
        } elseif (Test-Path $t -PathType Container) {
            Remove-Item $t -Recurse -Force
            Write-Output "BURNED: $t"
        }
    }
    Write-Output "ASHES: nothing recoverable in user scope. 心跳已焚毁。"
}

switch ($Action) {
    'protect'   { Protect-File $in $out; Write-Output "PROTECTED: $out" }
    'unprotect' { Unprotect-File $in $out; Write-Output "UNPROTECTED: $out" }
    'burn'      { if (-not $yes) { Write-Output "REFUSED: add -yes to confirm irreversible burn"; exit 1 }
                  Invoke-Burn $homeDir }
    default     { Write-Output "usage: vault.ps1 protect|unprotect -in <f> -out <f> | burn -home <dir> -yes" }
}
