#include "DHT.h"
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <LiquidCrystal_I2C.h>

#define TEMPERATURE_HUMIDITY_PIN 7
#define LIGHT_INTENSITY_PIN A1
#define TEMPERATURE_HUMIDITY_TYPE DHT11
#define GAS_PIN A0

Adafruit_BMP280 bmp;
DHT TemperatureHumidity_sensor(TEMPERATURE_HUMIDITY_PIN, TEMPERATURE_HUMIDITY_TYPE);

// Most 16x2 I2C LCDs use address 0x27 (if blank, try 0x3F)
LiquidCrystal_I2C lcd(0x27, 16, 2);

unsigned long timer = 0;

void setup() {
  Serial.begin(115200);
  TemperatureHumidity_sensor.begin();

  // Initialize the LCD
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Weather Station");
  lcd.setCursor(0, 1);
  lcd.print("Warming up...");

  if (!bmp.begin(0x76)) {
    Serial.println("Could not find a valid BMP280 sensor");
    lcd.clear();
    lcd.print("BMP280 Error!");
    while (1);
  }
}

void loop() {
  if ((millis() - timer) > 2000) {
    float humidity = TemperatureHumidity_sensor.readHumidity();
    float tempC = TemperatureHumidity_sensor.readTemperature();
    float pressureHPa = bmp.readPressure() / 100.0F;

    int light_level = analogRead(LIGHT_INTENSITY_PIN);
    int gasLevel = analogRead(GAS_PIN);

    float brightness = 100.0 - (light_level / 1023.0 * 100.0);
    float gasPercent = gasLevel / 1023.0 * 100.0;

    // Keep Serial Monitor output working
    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.print("%  |  Temperature: ");
    Serial.print(tempC);
    Serial.print("°C  |  Pressure: ");
    Serial.print(pressureHPa);
    Serial.print(" hPa  |  Brightness: ");
    Serial.print(brightness);
    Serial.print("%  |  Gas Reading (AO): ");
    Serial.print(gasPercent);
    Serial.println("%");

    // Update 16x2 LCD (16 characters max per row)
    lcd.clear();
    
    // Row 0: "T:22C H:48% 1013"
    lcd.setCursor(0, 0);
    lcd.print("T:");
    lcd.print((int)round(tempC));
    lcd.print("C H:");
    lcd.print((int)round(humidity));
    lcd.print("% ");
    lcd.print((int)round(pressureHPa));

    // Row 1: "Lit:75% Gas:14%"
    lcd.setCursor(0, 1);
    lcd.print("Lit:");
    lcd.print((int)round(brightness));
    lcd.print("% Gas:");
    lcd.print((int)round(gasPercent));
    lcd.print("%");

    timer = millis();
  }
}
