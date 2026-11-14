#include <Wire.h>
#include <MPU6050_light.h>

// Pin SCL to A5
// Pin SDA to A4

MPU6050 mpu(Wire);
unsigned long timer = 0;

void setup() {
  Serial.begin(9600);
  Wire.begin();
  
  byte status = mpu.begin();
  Serial.print(F("MPU6050 status: "));
  Serial.println(status);
  while (status != 0) { } // Stop everything if could not connect to MPU6050
  
  Serial.println(F("Calculating offsets, do not move MPU6050..."));
  delay(1000);
  mpu.calcOffsets(); // Calibrates gyro and accelerometer
  Serial.println("Done!\n");
}

void loop() {
  mpu.update(); // Continuously calculates the angles
  
  // Print values every 100ms so the Serial Monitor is readable
  if ((millis() - timer) > 1000) {
    Serial.print("Roll (X): ");
    Serial.print(mpu.getAngleX());
    Serial.print("\tPitch (Y): ");
    Serial.print(mpu.getAngleY());
    Serial.print("\tYaw (Z): ");
    Serial.println(mpu.getAngleZ());
    
    timer = millis();  
  }
}
