#include <Wire.h>
#include <MPU6050_light.h>
#include <WiFi.h>
#include <WebSocketsServer.h>

const char* ssid = "Phone?";
const char* password = "Eazy P@ss";

WebSocketsServer webSocket = WebSocketsServer(81); // WebSocket port 81
MPU6050 mpu(Wire);
unsigned long timer = 0;

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);

  // Initialize MPU6050
  byte status = mpu.begin();
  Serial.print(F("MPU6050 status: "));
  Serial.println(status);
  while (status != 0) { }
  
  Serial.println(F("Calculating offsets, do not move MPU6050..."));
  delay(1000);
  mpu.calcOffsets();
  Serial.println("Calibration done!");

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP()); // Copy this IP address for your web app!

  // Start WebSocket server
  webSocket.begin();
}

void loop() {
  webSocket.loop(); // Keep WebSocket connection alive
  mpu.update();     // Update sensor angles

  // Stream data every 30ms (~33 FPS for smooth 3D motion)
  if ((millis() - timer) > 30) {
    // Format as JSON string: {"r":12.34,"p":-5.67,"y":89.01}
    String json = "{\"r\":" + String(mpu.getAngleX(), 2) + 
                  ",\"p\":" + String(mpu.getAngleY(), 2) + 
                  ",\"y\":" + String(mpu.getAngleZ(), 2) + "}";
    
    webSocket.broadcastTXT(json);
    timer = millis();
  }
}
