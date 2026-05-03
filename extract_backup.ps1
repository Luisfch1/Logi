Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = 'c:\Users\ingen\Documents\APPS\Antigravity\Logi\Backup 10 de febrero.zip'
$destPath = 'c:\Users\ingen\Documents\APPS\Antigravity\Logi\legacy_sample.json'
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entry = $zip.Entries | Where-Object { $_.Name -eq 'backup.json' }
if ($entry) {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
    Write-Host "Extraído con éxito"
} else {
    Write-Host "No se encontró backup.json"
}
$zip.Dispose()
