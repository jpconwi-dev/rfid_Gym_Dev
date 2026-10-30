/*
  RFID Gym - Arduino Uno firmware
  USB serial (9600 baud) protocol with the website kiosk page:

  Arduino -> website
    READY                         boot finished
    UID: A1 B2 C3 D4              a card was tapped
    SD:<ok>:<usedKB>:<totalKB>    SD card status (1 = card OK, 0 = missing/error)

  Website -> Arduino
    LCD:<line1>|<line2>           show 2 lines on the LCD for ~4 seconds
    LOG:<text>                    append one line to LOG.CSV on the SD card
    SDINIT                        re-detect the SD card (after swapping it)
    SDCHECK                       report SD status now

  Wiring (SPI is shared by RC522 and the SD module):
    RC522  SDA/SS D10, SCK D13, MOSI D11, MISO D12, RST D9, 3.3V, GND
    SD     CS D4,      SCK D13, MOSI D11, MISO D12, VCC 5V (module with regulator), GND
    LCD    SDA A4, SCL A5, VCC 5V, GND
*/
#include <SPI.h>
#include <SD.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SS_PIN 10
#define RST_PIN 9
#define SD_CS 4
#define LOG_FILE "LOG.CSV"

// 0 = use the whole card. Set e.g. 2048 to cap gym data at ~2 MB (handy for testing the "SD full" bar).
const uint32_t SD_LIMIT_KB = 0;

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // use 0x3F if your LCD module needs it
Sd2Card card;
SdVolume volume;

bool sdOk = false;
uint32_t sdTotalKB = 0;
char lineBuf[72];
uint8_t lineLen = 0;
unsigned long idleAt = 0;

void lcdShow(const char *a, const char *b, bool temporary) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(a);
  lcd.setCursor(0, 1);
  lcd.print(b);
  idleAt = temporary ? millis() + 4000UL : 0;
}

void showIdle() { lcdShow("RFID MEMBERSHIP", "Scan your card", false); }

uint32_t logUsedKB() {
  File f = SD.open(LOG_FILE, FILE_READ);
  if (!f) return 0;
  uint32_t s = f.size();
  f.close();
  return s / 1024UL;
}

void sdInit() {
  sdOk = false;
  sdTotalKB = 0;
  if (card.init(SPI_HALF_SPEED, SD_CS) && volume.init(card) && SD.begin(SD_CS)) {
    sdOk = true;
    sdTotalKB = (uint32_t)volume.blocksPerCluster() * volume.clusterCount() / 2UL;  // 512-byte blocks -> KB
    if (SD_LIMIT_KB && SD_LIMIT_KB < sdTotalKB) sdTotalKB = SD_LIMIT_KB;
  }
}

void sdReport() {
  Serial.print(F("SD:"));
  Serial.print(sdOk ? 1 : 0);
  Serial.print(':');
  Serial.print(sdOk ? logUsedKB() : 0UL);
  Serial.print(':');
  Serial.println(sdTotalKB);
}

void sdLog(const char *text) {
  if (!sdOk) { sdInit(); }
  if (sdOk && logUsedKB() + 1 < sdTotalKB) {  // stop writing when full; website shows "replace SD card"
    File f = SD.open(LOG_FILE, FILE_WRITE);
    if (f) { f.println(text); f.close(); }
    else sdOk = false;  // card was pulled
  }
  sdReport();
}

void handleLine(char *s) {
  if (strncmp(s, "LCD:", 4) == 0) {
    char *a = s + 4;
    char *bar = strchr(a, '|');
    if (!bar) return;
    *bar = '\0';
    if (strlen(a) > 16) a[16] = '\0';
    char *b = bar + 1;
    if (strlen(b) > 16) b[16] = '\0';
    lcdShow(a, b, true);
  } else if (strncmp(s, "LOG:", 4) == 0) {
    sdLog(s + 4);
  } else if (strcmp(s, "SDINIT") == 0) {
    sdInit();
    sdReport();
  } else if (strcmp(s, "SDCHECK") == 0) {
    sdReport();
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) { lineBuf[lineLen] = '\0'; handleLine(lineBuf); lineLen = 0; }
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    }
  }
}

void setup() {
  Serial.begin(9600);
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(SS_PIN, OUTPUT);
  digitalWrite(SS_PIN, HIGH);
  SPI.begin();
  rfid.PCD_Init();
  lcd.init();
  lcd.backlight();
  lcdShow("RFID MEMBERSHIP", "Starting...", false);
  sdInit();
  showIdle();
  Serial.println(F("READY"));
  sdReport();
}

void loop() {
  readSerial();
  if (idleAt && millis() > idleAt) showIdle();

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  char uid[32];
  uint8_t n = 0;
  for (byte i = 0; i < rfid.uid.size && n < 28; i++) {
    n += snprintf(uid + n, 4, i ? " %02X" : "%02X", rfid.uid.uidByte[i]);
  }
  Serial.print(F("UID: "));
  Serial.println(uid);
  lcdShow("CARD SCANNED", "Please wait...", true);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(700);
}
