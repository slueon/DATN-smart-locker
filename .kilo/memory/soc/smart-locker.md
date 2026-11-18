# smart-locker

- The user decided the Smart Locker fill-rate (occupancy) KPI is OCCUPIED slots divided by the total number of slots; RESERVED slots are not counted as occupied (matches store.calculateKpi).
- Không dùng Out-File/Set-Content/Get-Content -Raw để ghi file có tiếng Việt (PowerShell 5.1 đọc theo cp1252 → hỏng UTF-8 hai lớp); dùng công cụ edit/write hoặc [System.IO.File]::WriteAllText với UTF8Encoding($false), rồi kiểm FFFD/BOM bằng node.
- The user wants the shipper's dynamic QR token to be one single stable code: pressing generate again must not mint a new code, and that same code must keep working for many deliveries (never one-time in effect).
- Smart Locker design rule: a deposit or pickup session is finalized only when the door closes and weight/IR confirm; the sensor's has_item alone must never set a compartment EMPTY or COMPLETED, or two orders can share one compartment.
