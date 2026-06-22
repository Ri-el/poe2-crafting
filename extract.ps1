$files = @(
    @{ Name = "ruby"; Path = "C:\Users\intern_sts\.gemini\antigravity\brain\080e915a-5bd7-469c-be27-0fb2e582add9\.system_generated\steps\71\content.md" },
    @{ Name = "emerald"; Path = "C:\Users\intern_sts\.gemini\antigravity\brain\080e915a-5bd7-469c-be27-0fb2e582add9\.system_generated\steps\75\content.md" },
    @{ Name = "sapphire"; Path = "C:\Users\intern_sts\.gemini\antigravity\brain\080e915a-5bd7-469c-be27-0fb2e582add9\.system_generated\steps\76\content.md" }
)

$result = @{}

foreach ($file in $files) {
    $content = Get-Content $file.Path -Raw
    if ($content -match 'new ModsView\((.*)\);') {
        $jsonStr = $matches[1]
        Set-Content -Path "C:\Users\intern_sts\Documents\poe2-crafting\data\$($file.Name)_raw.json" -Value $jsonStr -Encoding UTF8
        Write-Host "Extracted JSON for $($file.Name)"
    } else {
        Write-Host "Failed to find ModsView data in $($file.Name)"
    }
}
