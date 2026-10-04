$ErrorActionPreference = "Continue"
$Root = "C:\GNW-production-audit"
$Log = Join-Path $Root "artifacts\production-mission.log"
$State = Join-Path $Root "artifacts\production-mission-status.json"
$PgZip = Join-Path $Root "tools\postgresql-16.15-4-windows-x64-binaries.zip"
$PgRoot = Join-Path $Root "tools\postgresql"
$PgData = Join-Path $Root "artifacts\pgdata"
$PgPort = 55432
function Log([string]$m){ $line="$(Get-Date -Format o) $m"; Add-Content -Path $Log -Value $line; Write-Output $line }
function Run([string]$cmd){
  Log "RUN $cmd"
  cmd.exe /d /s /c $cmd 2>&1 | ForEach-Object { Add-Content -Path $Log -Value $_; Write-Output $_ }
  $code=$LASTEXITCODE
  Log "EXIT $code"
  return $code
}
Set-Location $Root
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Log "=== GNW PRODUCTION MISSION START ==="
$cycle=0
while($true){
  $cycle++
  Log "=== CYCLE $cycle ==="
  git status --short | Out-File (Join-Path $Root "artifacts\git-status-live.txt") -Encoding utf8
  $download=Get-Item $PgZip -ErrorAction SilentlyContinue
  if(-not $download -or $download.Length -lt 300000000){
    if(-not $download){ Log "PostgreSQL binary bundle missing; starting official download." }
    elseif($download.Length -lt 300000000){ Log ("PostgreSQL bundle incomplete: " + $download.Length + " bytes") }
    curl.exe -L --fail --retry 5 --retry-delay 3 -o $PgZip "https://get.enterprisedb.com/postgresql/postgresql-16.15-4-windows-x64-binaries.zip"
    $download=Get-Item $PgZip -ErrorAction SilentlyContinue
  }
  if($download -and $download.Length -ge 300000000){
    Log ("PostgreSQL bundle present: " + $download.Length + " bytes")
    if(-not (Test-Path (Join-Path $PgRoot "bin\pg_ctl.exe"))){
      python -c "import zipfile; z=zipfile.ZipFile(r'$PgZip'); z.extractall(r'$PgRoot'); print('POSTGRES_ZIP_OK')"
      if($LASTEXITCODE -eq 0){ Log "PostgreSQL bundle extracted." } else { Log "PostgreSQL bundle validation/extraction failed." }
    }
  }
  $PgCtl=Join-Path $PgRoot "bin\pg_ctl.exe"; $InitDb=Join-Path $PgRoot "bin\initdb.exe"; $Createdb=Join-Path $PgRoot "bin\createdb.exe"; $Psql=Join-Path $PgRoot "bin\psql.exe"
  if(Test-Path $PgCtl){
    if(-not (Test-Path $PgData)){ & $InitDb -D $PgData -U gnw -A trust --encoding=UTF8 | ForEach-Object { Add-Content $Log $_ }; Log "PostgreSQL cluster initialized." }
    & $Psql -h 127.0.0.1 -p $PgPort -U gnw -d postgres -c "SELECT 1" *> $null
    if($LASTEXITCODE -ne 0){ & $PgCtl -D $PgData -o "-p $PgPort -h 127.0.0.1" -l (Join-Path $Root "artifacts\postgres.log") start | ForEach-Object { Add-Content $Log $_ }; Start-Sleep 3 }
    & $Psql -h 127.0.0.1 -p $PgPort -U gnw -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='gnw_test'" 2>$null
    if($LASTEXITCODE -eq 0 -and -not ((& $Psql -h 127.0.0.1 -p $PgPort -U gnw -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='gnw_test'") -match "1")){
      & $Createdb -h 127.0.0.1 -p $PgPort -U gnw gnw_test; Log "Created gnw_test database."
    }
    $env:DATABASE_URL="postgresql://gnw@127.0.0.1:$PgPort/gnw_test"; $env:COOKIE_SECRET="gnw-local-test-cookie-secret-minimum-32-chars"; $env:NODE_ENV="test"; $env:LOG_LEVEL="silent"
  }
  $results=@{}
  $results.typecheck=(Run "npm run typecheck")
  $results.lint=(Run "npm run lint")
  if($env:DATABASE_URL){ $results.migrate=(Run "npm run db:migrate") } else { $results.migrate=99; Log "BLOCKED migrate: PostgreSQL unavailable." }
  $results.verify=(Run "npm run verify:production")
  $results.tests=(Run "npm run test")
  $results.coverage=(Run "npm run test:coverage")
  $results.build=(Run "npm run build")
  $results.audit=(Run "npm audit --audit-level=high")
  $status=[pscustomobject]@{timestamp=(Get-Date).ToUniversalTime().ToString("o");cycle=$cycle;results=$results;postgres=(Test-Path $PgCtl);git=(git rev-parse HEAD 2>$null)}
  $status | ConvertTo-Json -Depth 5 | Set-Content $State -Encoding utf8
  $pass=($results.typecheck -eq 0 -and $results.lint -eq 0 -and $results.migrate -eq 0 -and $results.verify -eq 0 -and $results.tests -eq 0 -and $results.coverage -eq 0 -and $results.build -eq 0 -and $results.audit -eq 0)
  if($pass){
    Log "LOCAL QUALITY GATES PASS."
    if(Test-Path (Join-Path $Root ".vercel\project.json")){
      Log "Vercel project linked; production deployment verification will be attempted."
      npx vercel --prod --yes 2>&1 | ForEach-Object { Add-Content $Log $_; Write-Output $_ }; $vc=$LASTEXITCODE; Log "VERCEL EXIT $vc"
      if($vc -eq 0){ $status | Add-Member -NotePropertyName deployment -NotePropertyValue "PASS" -Force; $status | ConvertTo-Json -Depth 5 | Set-Content $State -Encoding utf8; Log "=== PRODUCTION MISSION COMPLETE ==="; break }
    } else { Log "DEPLOYMENT BLOCKED: repository is not linked to a Vercel project; no new project will be created automatically." }
  } else { Log "QUALITY GATES NOT YET GREEN; retrying after 120s." }
  Start-Sleep 120
}