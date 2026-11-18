# smart-locker-mqtt

- Smart Locker firmware publishes ptit/{id}/receive/method (also rec/method) when a customer picks on the locker screen how to receive (QR), so the customer web must show a QR; the backend had no handler and silently dropped it as HW_MQTT_UNCLASSIFIED.
