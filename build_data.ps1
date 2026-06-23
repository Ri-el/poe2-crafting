$ErrorActionPreference = "Stop"

function Strip-Html {
    param($html)
    if (-not $html) { return "" }
    # Replace the ndash span with a dash
    $html = $html -replace '<span class="ndash">—</span>', '-'
    # Remove all HTML tags
    $text = $html -replace '<[^>]+>', ''
    # Decode HTML entities
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    return $text.Trim()
}

$types = @(
    @{ Id="ruby"; Name="Ruby"; Attr="Strength"; File="data\ruby_raw.json" },
    @{ Id="emerald"; Name="Emerald"; Attr="Dexterity"; File="data\emerald_raw.json" },
    @{ Id="sapphire"; Name="Sapphire"; Attr="Intelligence"; File="data\sapphire_raw.json" }
)

# Only regenerate mod data from raw PoE2DB dumps when they're actually present.
# They're optional/legacy — the curated data\jewel-mods.v2.json is the source of
# truth. Without this guard, a missing raw file would crash before the .data.js
# wrappers below get refreshed.
$rawFilesPresent = ($types | Where-Object { Test-Path $_.File }).Count -eq $types.Count

if ($rawFilesPresent) {

$output = @{ jewelTypes = @{} }

foreach ($t in $types) {
    Write-Host "Processing $($t.Name)..."
    $rawText = Get-Content $t.File -Raw
    $data = ConvertFrom-Json $rawText

    $prefixes = @{}
    $suffixes = @{}
    $vaalEnchants = @()

    foreach ($mod in $data.normal) {
        $typeId = $mod.ModGenerationTypeID
        # 1: Prefix, 2: Suffix, 3: Vaal/Corrupted (or from class)
        
        # Check if it's a Vaal enchantment
        # In PoE2DB, Vaal orb enchantments usually have class "enchantMod" or similar, 
        # but let's check if there is a 'VaalOrbCorruptedEnchantment' in the tags/classes or we can just pull corrupted
        
        $isVaal = $false
        # The data structure from PoE2DB has 'config' which has 'corrupted'
        # We also can just check if ModFamilyList contains "Corrupted" or if ModGenerationTypeID is something else
        # Actually, looking at typical PoE2DB JSON, corrupted mods might not be in the 'normal' array or might have a specific family.
        
        $familyName = "Unknown"
        if ($mod.ModFamilyList -is [array] -and $mod.ModFamilyList.Count -gt 0) {
            $familyName = $mod.ModFamilyList[0]
        } elseif ($mod.ModFamilyList) {
            $familyName = $mod.ModFamilyList
        }

        # If it's a corrupted mod, we can add it to Vaal enchants
        if ($familyName -match "Corrupted" -or $mod.Name -match "Vaal") {
            $isVaal = $true
        }

        # Parse min/max and clean text
        $rawStr = $mod.str
        $cleanStr = Strip-Html $rawStr
        $min = 0
        $max = 0
        
        if ($cleanStr -match '\((\d+)-(\d+)\)') {
            $min = [int]$matches[1]
            $max = [int]$matches[2]
            $cleanStr = $cleanStr -replace '\(\d+-\d+\)', '{0}'
        } elseif ($cleanStr -match '\+?(\d+)') {
            # Single value without range?
            $min = [int]$matches[1]
            $max = [int]$matches[1]
            $cleanStr = $cleanStr -replace $min, '{0}'
        }

        $tierName = $mod.Name
        if (-not $tierName) { $tierName = "Tier" }
        
        $weight = [int]$mod.DropChance
        if ($weight -eq 0 -or -not $weight) {
            # Estimate weight: higher ilvl requirement -> lower weight
            $req = [int]$mod.Level
            if ($req -gt 70) { $weight = 250 }
            elseif ($req -gt 50) { $weight = 500 }
            elseif ($req -gt 30) { $weight = 750 }
            else { $weight = 1000 }
        }

        $modObj = @{
            tier = 1 # will recalculate
            name = $tierName
            modLine = $cleanStr
            min = $min
            max = $max
            ilvlReq = [int]$mod.Level
            weight = $weight
        }

        if ($isVaal) {
            $vaalEnchants += @{ text = $cleanStr; weight = $weight }
        } elseif ($typeId -eq 1 -or $typeId -eq 2) {
            $dict = if ($typeId -eq 1) { $prefixes } else { $suffixes }
            if (-not $dict.ContainsKey($familyName)) {
                $dict[$familyName] = @{
                    modGroup = $familyName
                    tiers = @()
                }
            }
            $dict[$familyName].tiers += $modObj
        }
    }

    # Sort tiers by ilvlReq descending and assign tier numbers (1 = highest ilvlReq)
    function Process-Dict($dict) {
        $resultList = @()
        foreach ($key in $dict.Keys) {
            $group = $dict[$key]
            $sortedTiers = $group.tiers | Sort-Object ilvlReq -Descending
            $t = 1
            $newTiers = @()
            foreach ($tier in $sortedTiers) {
                $tier.tier = $t
                $newTiers += $tier
                $t++
            }
            $group.tiers = $newTiers
            $resultList += $group
        }
        return $resultList
    }

    $prefixList = Process-Dict $prefixes
    $suffixList = Process-Dict $suffixes

    # If we didn't find specific vaal enchantments, let's add some default PoE2 Vaal enchantments
    if ($vaalEnchants.Count -eq 0) {
        $vaalEnchants = @(
            @{ text = "Corrupted Blood cannot be inflicted on you"; weight = 100 },
            @{ text = "Cannot be Blinded"; weight = 100 },
            @{ text = "You cannot be Hindered"; weight = 100 },
            @{ text = "+{0}% to Chaos Resistance"; min = 3; max = 5; weight = 200 },
            @{ text = "Immune to Maim"; weight = 100 },
            @{ text = "Damaging Ailments cannot be inflicted on you"; weight = 50 }
        )
    }

    $output.jewelTypes[$t.Id] = @{
        name = $t.Name
        attribute = $t.Attr
        prefixes = $prefixList
        suffixes = $suffixList
        vaalEnchantments = $vaalEnchants
    }
}

$jsonOut = $output | ConvertTo-Json -Depth 10
Set-Content "data\jewel-mods.json" -Value $jsonOut -Encoding UTF8
Write-Host "Generated data\jewel-mods.json successfully!"
}
else {
    Write-Host "Raw PoE2DB dumps not found - skipping mod regeneration. Using existing data\jewel-mods.v2.json as the source of truth."
}

# ============================================================
#  Emit file:// friendly data modules (runs automatically each build)
#  Mirrors the JSON the app actually loads into global-variable .js
#  files so index.html works by double-click (no server, no fetch).
#  If you regenerate the JSON, just run this script and the .data.js
#  wrappers refresh to match.
# ============================================================
function Write-DataModule {
    param([string]$JsonFile, [string]$GlobalName, [string]$OutFile)

    if (-not (Test-Path $JsonFile)) {
        Write-Host "Skipped $OutFile (source $JsonFile not found)"
        return
    }

    # Read raw JSON and drop a leading UTF-8 BOM so it parses cleanly as JS
    $json = (Get-Content $JsonFile -Raw).TrimStart([char]0xFEFF)
    $module = "window.$GlobalName = " + $json.TrimEnd() + ";`r`n"

    # Write UTF-8 WITHOUT a BOM so the script loads cleanly from file://
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path (Get-Location) $OutFile), $module, $enc)
    Write-Host "Generated $OutFile"
}

Write-DataModule "data\desecrated-mods.json" "DESECRATED_MODS_RAW" "data\desecrated-mods.data.js"

# Compile every per-base file in data\bases (and optional data\shared) into ONE
# file:// loader: data\mods.data.js  (so index.html only needs one script tag).
$loader = "window.MOD_BASES = window.MOD_BASES || {};`r`nwindow.MOD_SHARED = window.MOD_SHARED || {};`r`n"
Get-ChildItem -Path "data\bases" -Filter *.json | Sort-Object Name | ForEach-Object {
    $id  = $_.BaseName
    $raw = (Get-Content $_.FullName -Raw).TrimStart([char]0xFEFF).Trim()
    $null = ConvertFrom-Json $raw   # validate JSON; stops the build on a typo
    $loader += 'window.MOD_BASES[' + (ConvertTo-Json $id) + '] = ' + $raw + ";`r`n"
}
if (Test-Path "data\shared") {
    Get-ChildItem -Path "data\shared" -Filter *.json | Sort-Object Name | ForEach-Object {
        $key = $_.BaseName
        $raw = (Get-Content $_.FullName -Raw).TrimStart([char]0xFEFF).Trim()
        $null = ConvertFrom-Json $raw
        $loader += 'window.MOD_SHARED[' + (ConvertTo-Json $key) + '] = ' + $raw + ";`r`n"
    }
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "data\mods.data.js"), $loader, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Generated data\mods.data.js"
