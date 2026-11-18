# project

- The user's Smart Locker project is a PTIT graduation project (Faculty of Telecommunications 1): React 19 + Vite + Tailwind web app, Spring Boot backend with MySQL and MQTT, and ESP32 firmware.
- The user's first priority for the Smart Locker team is security, ahead of data cleanup and building real tests.
- The user decided the defense demo opens the locker with a dynamic QR from the web (60s, scanned by the GM65 camera); static shipper codes stay empty permanently, so a hardcoded QR returning "0" is correct behavior, not a bug.
- The Smart Locker repo no longer has smart_locker_db.sql (its DROP DATABASE used to wipe the shared DB); it is split into schema.sql (DDL only, CREATE ... IF NOT EXISTS, safe to re-run without data loss) and seed.sql (INSERT only), and the old file stays only in git history.
- The user decided the project's MQTT protocol: uplink uses one shared topic without a locker id (payload carries locker_id) so many lockers publish there, downlink uses a per-locker topic with {id}; MQTT_GUIDE.md §3 draws uplink wrong, so it is not followed literally.
- The user decided that for pre-booked orders the shipper picks the compartment on the web (list PENDING orders, GET /api/lockers/{id}/compartments, send compartmentIndex on reserve); walk-in shippers still pick on the TFT because the firmware opens the compartment before telling the backend.
- The user wants ShipperTab to call the real API instead of mock data.
- The user decided a pre-booked shipper may change the compartment already assigned to an order; orders gains a shipper_reserved_at column (NULL = assigned by the system when the order is created, NOT NULL = reserved by the shipper), so 'reserved' and 'not reserved' stay distinguishable.
- Device-id-to-locker mapping in the Smart Locker backend is config-driven (mqtt.locker.prefix.<deviceId>, default LOCKER_HN_01, empty to disable), because some firmware publishes compartment status without a locker_id; khuon_vien=LOCKER_HN_01 and thiet_bi_2=LOCKER_HN_02.
