#include "DHT.h"

#define TEMPERATURE_HUMIDITY_PIN 7       // Digital pin connected to the Signal (S) pin
#define LIGHT_INTENSITY_PIN 8

#define TEMPERATURE_HUMIDITY_TYPE DHT11  // Define the sensor type as DHT11

DHT TemperatureHumidity_sensor(TEMPERATURE_HUMIDITY_PIN, TEMPERATURE_HUMIDITY_TYPE);
float timer01, timer02 = 0;

void setup() {
  Serial.begin(115200);
  TemperatureHumidity_sensor.begin();
}

void loop() {
  if((millis() - timer01) > 2000)
  {
    float humidity = TemperatureHumidity_sensor.readHumidity();
    float tempC = TemperatureHumidity_sensor.readTemperature();

    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.print("%  |  Temperature: ");
    Serial.print(tempC);
    Serial.println("°C");
    timer01 = millis();
  }
  if((millis() - timer02) > 2000)
  {
    int light_level = analogRead(LIGHT_INTENSITY_PIN);
    Serial.print("Brightness: ");
    Serial.println(light_level);
    timer02 = millis();
  }
}
