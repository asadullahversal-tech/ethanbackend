# Test all three providers (Orange, Vodacom, Airtel) with USD payments
# This tests if amount should be string or number

$token = "eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJ0dCI6IkFBVCIsInN1YiI6IjE4NzUiLCJtYXYiOiIxIiwiZXhwIjoyMDgyNTUzNjA5LCJpYXQiOjE3NjcwMjA4MDksInBtIjoiREFGLFBBRiIsImp0aSI6ImJjZDEwNjViLWI2N2EtNGZlMi04OTBmLTQ0NjI5ZTRlZTAyMiJ9.VjBkfAQilr332UntoyyK_3IRvyWwqdQ1f3W7jJJ91bauSyvA3V7X5VBVqDK8fvZYX9Byggwh2Pkqk7Q8EyKipg"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
    "Accept" = "application/json"
}

# Test 1: Orange with amount as STRING
Write-Host "`n=== Test 1: Orange (amount as STRING) ===" -ForegroundColor Cyan
$orangeString = @{
    depositId = "c3f3c333-3333-4ccc-8ccc-333333333333"
    amount = "1"
    currency = "USD"
    payer = @{
        type = "MMO"
        accountDetails = @{
            provider = "ORANGE_COD"
            phoneNumber = "243998138612"
        }
    }
    clientReferenceId = "INVUSDORANGE001"
    customerMessage = "Orange payment USD"
    metadata = @(
        @{ key = "orderId"; value = "ORDUSDORANGE001" }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "https://api.pawapay.io/v2/deposits" `
        -Method POST `
        -Headers $headers `
        -Body $orangeString `
        -ContentType "application/json"
    Write-Host "✅ Orange (string amount) - SUCCESS" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Orange (string amount) - FAILED" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        $reader.Close()
        $errorBody | ConvertFrom-Json | ConvertTo-Json -Depth 10
    }
}

Start-Sleep -Seconds 2

# Test 2: Vodacom with amount as STRING
Write-Host "`n=== Test 2: Vodacom (amount as STRING) ===" -ForegroundColor Cyan
$vodacomString = @{
    depositId = "a1f1c111-1111-4aaa-8aaa-111111111111"
    amount = "1"
    currency = "USD"
    payer = @{
        type = "MMO"
        accountDetails = @{
            provider = "VODACOM_MPESA_COD"
            phoneNumber = "243998138612"
        }
    }
    clientReferenceId = "INVUSDVODA001"
    customerMessage = "Vodacom payment USD"
    metadata = @(
        @{ key = "orderId"; value = "ORDUSDVODA001" }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "https://api.pawapay.io/v2/deposits" `
        -Method POST `
        -Headers $headers `
        -Body $vodacomString `
        -ContentType "application/json"
    Write-Host "✅ Vodacom (string amount) - SUCCESS" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Vodacom (string amount) - FAILED" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        $reader.Close()
        $errorBody | ConvertFrom-Json | ConvertTo-Json -Depth 10
    }
}

Start-Sleep -Seconds 2

# Test 3: Airtel with amount as NUMBER
Write-Host "`n=== Test 3: Airtel (amount as NUMBER) ===" -ForegroundColor Cyan
$airtelNumber = @{
    depositId = "e5a8f3c2-4d9f-4a7b-9e52-2f3b1a0d8c29"
    amount = 1
    currency = "USD"
    payer = @{
        type = "MMO"
        accountDetails = @{
            provider = "AIRTEL_COD"
            phoneNumber = "243998138612"
        }
    }
    clientReferenceId = "INVUSD002"
    customerMessage = "Payment test 1 USD"
    metadata = @(
        @{ key = "orderId"; value = "ORDUSD002" }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "https://api.pawapay.io/v2/deposits" `
        -Method POST `
        -Headers $headers `
        -Body $airtelNumber `
        -ContentType "application/json"
    Write-Host "✅ Airtel (number amount) - SUCCESS" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Airtel (number amount) - FAILED" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        $reader.Close()
        $errorBody | ConvertFrom-Json | ConvertTo-Json -Depth 10
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Yellow
Write-Host "All tests completed. Check results above." -ForegroundColor Yellow

