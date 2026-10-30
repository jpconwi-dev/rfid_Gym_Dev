/*
  RFID Gym - Arduino Uno firmware (secure cards)
  USB serial (9600 baud) protocol with the website kiosk page:

  Arduino -> website
    READY                          boot finished
    CARD:<uid>|<token or NONE>     a card was tapped (token = secret read from the card)
    WROTE:OK / WROTE:FAIL          result of a WRITE command
    SD:<ok>:<usedKB>:<totalKB>     SD card status (1 = card OK, 0 = missing/error)

  Website -> Arduino
    LCD:<line1>|<line2>            show 2 lines on the LCD for ~4 seconds
    WRITE:<32 hex>                 write the member's secret into the card and lock it
    LOG:<text>                     append one line to LOG.CSV on the SD card
    SDINIT / SDCHECK               re-detect / report the SD card

  SECURE CARDS: the secret is stored in sector 1 of a MIFARE Classic card, locked with SECRET_KEY below.
  A copied card number alone (UID) is then not enough to enter the gym.
  !! Keep SECRET_KEY private. Changing it later makes every already-secured card stop working.

  Wiring (SPI is shared by RC522 and the SD module):
    RC522  SDA/SS D10, SCK D13, MOSI D11, MISO D12, RST D9, 3.3V, GND
    SD     CS D4,      SCK D13, MOSI D11, MISO D12, VCC 5V (module with regulator), GND
    LCD    SDA A4, SCL A5, VCC 5V, GND
*/
#define USE_SD 1  // set to 0 to run WITHOUT the SD module (useful for testing the scanner alone)
#include <SPI.h>
#if USE_SD
#include <SD.h>
#endif
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SS_PIN 10
#define RST_PIN 9
#define SD_CS 4
#define LOG_FILE "LOG.CSV"
#define TOKEN_BLOCK 4
#define TRAILER_BLOCK 7

// Your private card key (random, generated for you). Do not share this file publicly.
const byte SECRET_KEY[6] = { 0xD2, 0xD7, 0xE4, 0xE2, 0x1A, 0xDF };

// 0 = use the whole card. Set e.g. 2048 to cap gym data at ~2 MB (handy for testing the "SD full" bar).
const uint32_t SD_LIMIT_KB = 0;

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // use 0x3F if your LCD module needs it
#if USE_SD
Sd2Card card;
SdVolume volume;
#endif
MFRC522::MIFARE_Key keySecret, keyDefault;

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

// ---------------------------------------------------------------- secure card helpers
bool isClassic() {
  MFRC522::PICC_Type t = rfid.PICC_GetType(rfid.uid.sak);
  return t == MFRC522::PICC_TYPE_MIFARE_1K || t == MFRC522::PICC_TYPE_MIFARE_4K;
}

bool wake() {  // re-select the card that is still on the reader
  byte atqa[2];
  byte sz = sizeof(atqa);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(5);
  if (rfid.PICC_WakeupA(atqa, &sz) != MFRC522::STATUS_OK) return false;
  return rfid.PICC_ReadCardSerial();
}

bool authBlock(byte block, MFRC522::MIFARE_Key *k) {
  return rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, block, k, &rfid.uid) == MFRC522::STATUS_OK;
}

bool readToken(char *out) {  // out must hold 33 chars
  if (!isClassic()) return false;
  if (!authBlock(TOKEN_BLOCK, &keySecret)) return false;
  byte buf[18];
  byte sz = sizeof(buf);
  if (rfid.MIFARE_Read(TOKEN_BLOCK, buf, &sz) != MFRC522::STATUS_OK) return false;
  for (byte i = 0; i < 16; i++) sprintf(out + i * 2, "%02X", buf[i]);
  return true;
}

byte nib(char c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }

bool provision(const char *hex) {
  if (strlen(hex) != 32 || !isClassic()) return false;
  byte data[16];
  for (byte i = 0; i < 16; i++) data[i] = (nib(hex[i * 2]) << 4) | nib(hex[i * 2 + 1]);
  // new card = factory key; already secured card = our key
  bool ok = (wake() && authBlock(TOKEN_BLOCK, &keyDefault)) || (wake() && authBlock(TOKEN_BLOCK, &keySecret));
  if (!ok) return false;
  if (rfid.MIFARE_Write(TOKEN_BLOCK, data, 16) != MFRC522::STATUS_OK) return false;
  byte tr[16];
  for (byte i = 0; i < 6; i++) { tr[i] = SECRET_KEY[i]; tr[10 + i] = SECRET_KEY[i]; }  // key A and key B
  tr[6] = 0xFF; tr[7] = 0x07; tr[8] = 0x80; tr[9] = 0x69;                              // standard access bits
  if (rfid.MIFARE_Write(TRAILER_BLOCK, tr, 16) != MFRC522::STATUS_OK) return false;
  char chk[33];
  return wake() && readToken(chk) && strcasecmp(chk, hex) == 0;  // verify what we wrote
}

// ---------------------------------------------------------------- SD card
#if USE_SD
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
#else
void sdInit() {}
void sdReport() { Serial.println(F("SD:0:0:0")); }
void sdLog(const char *) { sdReport(); }
#endif

// ---------------------------------------------------------------- serial commands
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
  } else if (strncmp(s, "WRITE:", 6) == 0) {
    lcdShow("SECURING CARD", "KEEP ON READER", true);
    bool ok = provision(s + 6);
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    Serial.println(ok ? F("WROTE:OK") : F("WROTE:FAIL"));
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
  for (byte i = 0; i < 6; i++) { keySecret.keyByte[i] = SECRET_KEY[i]; keyDefault.keyByte[i] = 0xFF; }
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
  char tok[33];
  bool hasTok = readToken(tok);  // secret stored on the card (if it was secured)
  Serial.print(F("CARD:"));
  Serial.print(uid);
  Serial.print('|');
  Serial.println(hasTok ? tok : "NONE");
  lcdShow("CARD SCANNED", "Please wait...", true);

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(700);
}
