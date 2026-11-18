# Memory

- Process rule for sóc: never run `clean test` or restart the backend while minh is verifying — wait for Chief's go-ahead, since overlapping runs corrupt the verification.
- Check that MQTT is alive with a real publish (device_events grows within ~1 s), not by reading `devctl status`; its MQTT line has been wrong before.

## Index
- [[smart-locker]]
