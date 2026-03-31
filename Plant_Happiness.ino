// ============================================
// SMART PLANT BUDDY — Arduino Firmware
// Sensors: FC-28 soil moisture + DHT11
// Outputs: status RGB LED + health RGB LED + passive buzzer + 1.8 TFT
// Serial: JSON stream to Python logger
// TFT assumption: ST7735 128x160 SPI display
// ============================================

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <DHT.h>

#define SOIL_PIN       A0
#define DHT_PIN         7
#define DHT_TYPE    DHT11

// Moisture/status LED
#define LED_R           6
#define LED_G           8
#define LED_B           9

// Overall health LED
#define HEALTH_LED_R    3
#define HEALTH_LED_G    5
#define HEALTH_LED_B   11

// Buzzer
#define BUZZER_PIN      4

// TFT pins use software SPI
#define TFT_CS         10
#define TFT_DC         12
#define TFT_RST        A1
#define TFT_MOSI       A2
#define TFT_SCLK       A3

const int   SOIL_RAW_WET         = 320;
const int   SOIL_RAW_DRY         = 820;
const int   SOIL_SURFACE_DRY_PCT = 70;
const int   SOIL_DRY_PCT         = 50;
const int   SOIL_WET_PCT         = 80;
const int   SOIL_DRENCHED_PCT    = 90;

const float TEMP_OPT_LOW         = 20.0;
const float TEMP_OPT_HIGH        = 30.0;
const float TEMP_WARN_MARGIN     = 2.0;
const float TEMP_CRIT_HIGH       = 35.0;
const float TEMP_CRIT_LOW        = 12.0;
const float HUMID_LOW            = 35.0;
const float HUMID_HIGH           = 85.0;

const unsigned long READ_EVERY    = 2000;
const unsigned long TFT_ROTATE_MS = 4500;
const unsigned long ALERT_BEEP_MS = 1500;

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCLK, TFT_RST);
DHT dht(DHT_PIN, DHT_TYPE);

enum PlantStatus {
  HAPPY,
  DRY,
  THIRSTY,
  WET,
  DRENCHED,
  HOT,
  COLD,
  CRITICAL_HOT,
  CRITICAL_COLD
};

enum PlantProblem {
  NO_PROBLEM,
  TOO_HOT,
  TOO_COLD,
  TOO_HUMID,
  TOO_DRY
};

enum HealthLight {
  HEALTH_GOOD,
  HEALTH_FINE,
  HEALTH_BAD
};

unsigned long lastRead = 0;
unsigned long lastTftFlip = 0;
unsigned long lastBeepMs = 0;
uint8_t tftPage = 0;

PlantStatus status = HAPPY;
PlantProblem problem = NO_PROBLEM;
HealthLight healthLight = HEALTH_FINE;

int currentSoilPct = 0;
float currentTempC = 0.0;
float currentHumidity = 0.0;
int overallScore = 0;
bool tftReady = false;

void writeLedChannel(int pin, int value) {
  if (pin == 3 || pin == 5 || pin == 6 || pin == 9 || pin == 10 || pin == 11) {
    analogWrite(pin, value);
  } else {
    digitalWrite(pin, value >= 128 ? HIGH : LOW);
  }
}

void setStatusLED(int r, int g, int b) {
  writeLedChannel(LED_R, r);
  writeLedChannel(LED_G, g);
  writeLedChannel(LED_B, b);
}

void setHealthLED(int r, int g, int b) {
  writeLedChannel(HEALTH_LED_R, r);
  writeLedChannel(HEALTH_LED_G, g);
  writeLedChannel(HEALTH_LED_B, b);
}

bool soilGood(int soilPct) {
  return soilPct >= 65 && soilPct <= 100;
}

bool tempGood(float tempC) {
  return tempC >= 25.0 && tempC <= 32.0;
}

bool humidityGood(float humidity) {
  return humidity >= 45.0 && humidity <= 95.0;
}

PlantProblem detectProblem(int soilPct, float tempC, float humidity) {
  if (tempC >= TEMP_CRIT_HIGH || tempC > TEMP_OPT_HIGH + TEMP_WARN_MARGIN) return TOO_HOT;
  if (tempC <= TEMP_CRIT_LOW || tempC < TEMP_OPT_LOW - TEMP_WARN_MARGIN) return TOO_COLD;
  if (humidity >= HUMID_HIGH) return TOO_HUMID;
  if (humidity <= HUMID_LOW) return TOO_DRY;
  return NO_PROBLEM;
}

PlantStatus detectStatus(int soilPct, float tempC, PlantProblem currentProblem) {
  if (tempC >= TEMP_CRIT_HIGH) return CRITICAL_HOT;
  if (tempC <= TEMP_CRIT_LOW) return CRITICAL_COLD;
  if (soilPct <= SOIL_DRY_PCT) return THIRSTY;
  if (soilPct <= SOIL_SURFACE_DRY_PCT) return DRY;
  if (soilPct >= SOIL_DRENCHED_PCT) return DRENCHED;
  if (soilPct >= SOIL_WET_PCT) return WET;
  if (currentProblem == TOO_HOT) return HOT;
  if (currentProblem == TOO_COLD) return COLD;
  return HAPPY;
}

HealthLight detectHealthLight(int soilPct, float tempC, float humidity) {
  int goodCount = (soilGood(soilPct) ? 1 : 0) +
                  (tempGood(tempC) ? 1 : 0) +
                  (humidityGood(humidity) ? 1 : 0);

  if (goodCount == 3) return HEALTH_GOOD;
  if (goodCount == 2) return HEALTH_FINE;
  return HEALTH_BAD;
}

int calculateOverallScore(int soilPct, float tempC, float humidity, PlantStatus currentStatus, PlantProblem currentProblem) {
  float soilScore = constrain(100.0 - abs(soilPct - 75) * 2.0, 0.0, 100.0);
  float tempCenter = (TEMP_OPT_LOW + TEMP_OPT_HIGH) / 2.0;
  float tempRange = (TEMP_OPT_HIGH - TEMP_OPT_LOW) / 2.0;
  float tempScore = constrain(100.0 - (abs(tempC - tempCenter) / max(tempRange, 0.1)) * 28.0, 0.0, 100.0);
  float humidityScore = constrain(100.0 - abs(humidity - 60.0) * 2.2, 0.0, 100.0);

  float combined = soilScore * 0.45 + tempScore * 0.35 + humidityScore * 0.20;

  switch (currentStatus) {
    case HAPPY:         combined += 8;  break;
    case DRY:           combined -= 10; break;
    case THIRSTY:       combined -= 22; break;
    case WET:           combined -= 8;  break;
    case DRENCHED:      combined -= 18; break;
    case HOT:
    case COLD:          combined -= 15; break;
    case CRITICAL_HOT:
    case CRITICAL_COLD: combined -= 35; break;
  }

  switch (currentProblem) {
    case TOO_HOT:
    case TOO_COLD: combined -= 10; break;
    case TOO_HUMID:
    case TOO_DRY:  combined -= 6;  break;
    case NO_PROBLEM: break;
  }

  return constrain((int)combined, 0, 100);
}

const char* statusLabel(PlantStatus value) {
  switch (value) {
    case HAPPY: return "HAPPY";
    case DRY: return "DRY";
    case THIRSTY: return "THIRSTY";
    case WET: return "WET";
    case DRENCHED: return "DRENCHED";
    case HOT: return "HOT";
    case COLD: return "COLD";
    case CRITICAL_HOT: return "CRIT HOT";
    case CRITICAL_COLD: return "CRIT COLD";
  }
  return "UNKNOWN";
}

const char* shortProblemLabel(PlantProblem value) {
  switch (value) {
    case NO_PROBLEM: return "NONE";
    case TOO_HOT: return "HOT";
    case TOO_COLD: return "COLD";
    case TOO_HUMID: return "HUMID";
    case TOO_DRY: return "DRY";
  }
  return "UNKNOWN";
}

const char* healthLabel(HealthLight value) {
  switch (value) {
    case HEALTH_GOOD: return "GOOD";
    case HEALTH_FINE: return "FINE";
    case HEALTH_BAD: return "BAD";
  }
  return "UNKNOWN";
}

const char* faceForStatus(PlantStatus value) {
  switch (value) {
    case HAPPY: return "^_^";
    case DRY: return "-_-";
    case THIRSTY: return "T_T";
    case HOT: return "@_@";
    case COLD: return "._.";
    case DRENCHED: return "o_o";
    default: return "o_o";
  }
}

const char* adviceLine1() {
  if (status == THIRSTY) return "Water now";
  if (status == DRY) return "Water soon";
  if (problem == TOO_HOT) return "Move to shade";
  if (problem == TOO_COLD) return "Warm the area";
  if (problem == TOO_HUMID) return "Add airflow";
  if (problem == TOO_DRY) return "Raise humidity";
  if (status == DRENCHED) return "Stop watering";
  return "All stable";
}

const char* adviceLine2() {
  if (overallScore >= 80) return "Plant looks healthy";
  if (overallScore >= 60) return "Monitor closely";
  if (overallScore >= 40) return "Needs attention";
  return "Take action soon";
}

void updateStatusLED() {
  if (currentSoilPct <= SOIL_DRY_PCT) {
    setStatusLED(255, 0, 0);
    return;
  }
  if (currentSoilPct <= SOIL_SURFACE_DRY_PCT) {
    setStatusLED(255, 200, 0);
    return;
  }
  setStatusLED(0, 255, 0);
}

void updateHealthLED() {
  bool goodSoil = soilGood(currentSoilPct);
  bool goodTemp = tempGood(currentTempC);
  bool goodHumidity = humidityGood(currentHumidity);
  int goodCount = (goodSoil ? 1 : 0) + (goodTemp ? 1 : 0) + (goodHumidity ? 1 : 0);

  if (goodSoil && goodTemp && goodHumidity) {
    setHealthLED(0, 255, 0);
  } else if (goodSoil && !goodTemp && !goodHumidity) {
    setHealthLED(180, 110, 0);
  } else if (goodSoil && goodTemp && !goodHumidity) {
    setHealthLED(120, 255, 40);
  } else if (goodSoil && !goodTemp && goodHumidity) {
    setHealthLED(170, 220, 0);
  } else if (!goodSoil && goodTemp && goodHumidity) {
    setHealthLED(255, 120, 0);
  } else if (goodCount == 1) {
    setHealthLED(255, 60, 0);
  } else {
    setHealthLED(255, 0, 0);
  }
}

void updateBuzzer() {
  static unsigned long lastCritHotBeep = 0;
  static unsigned long lastCritColdBeep = 0;

  if (status == CRITICAL_HOT) {
    if (millis() - lastCritHotBeep >= 60) {
      lastCritHotBeep = millis();
      tone(BUZZER_PIN, 4000, 45);
    }
    return;
  }

  if (status == CRITICAL_COLD) {
    if (millis() - lastCritColdBeep >= 260) {
      lastCritColdBeep = millis();
      tone(BUZZER_PIN, 2600, 120);
    }
    return;
  }

  if (healthLight != HEALTH_BAD) {
    noTone(BUZZER_PIN);
    return;
  }

  if (millis() - lastBeepMs >= ALERT_BEEP_MS) {
    lastBeepMs = millis();
    tone(BUZZER_PIN, 2400, 120);
  }
}

void header(const char *title, uint16_t color) {
  tft.fillRect(0, 0, 160, 20, color);
  tft.setTextColor(ST77XX_BLACK, color);
  tft.setTextSize(2);
  tft.setCursor(6, 3);
  tft.print(title);
  tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
}

void drawScorePage() {
  header("SCORE", ST77XX_GREEN);
  tft.fillRoundRect(18, 28, 120, 46, 8, ST77XX_BLACK);
  tft.drawRoundRect(18, 28, 120, 46, 8, ST77XX_YELLOW);
  tft.setTextColor(ST77XX_YELLOW, ST77XX_BLACK);
  tft.setTextSize(4);

  if (overallScore < 10) tft.setCursor(60, 38);
  else if (overallScore < 100) tft.setCursor(48, 38);
  else tft.setCursor(36, 38);

  tft.print(overallScore);

  tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
  tft.setTextSize(2);
  tft.setCursor(16, 88);
  tft.print(statusLabel(status));

  tft.setTextSize(1);
  tft.setCursor(16, 112);
  tft.print("Health: ");
  tft.print(healthLabel(healthLight));
}

void drawReadingsPage() {
  header("LIVE", ST77XX_CYAN);
  tft.setTextSize(2);
  tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);

  tft.setCursor(8, 28);  tft.print("Soil:");
  tft.setCursor(88, 28); tft.print(currentSoilPct); tft.print('%');

  tft.setCursor(8, 54);  tft.print("Temp:");
  tft.setCursor(88, 54); tft.print(currentTempC, 1); tft.print('C');

  tft.setCursor(8, 80);  tft.print("Hum:");
  tft.setCursor(88, 80); tft.print(currentHumidity, 0); tft.print('%');

  tft.setTextSize(1);
  tft.setCursor(8, 108);
  tft.print("Problem: ");
  tft.print(shortProblemLabel(problem));
}

void drawMoodPage() {
  uint16_t banner = healthLight == HEALTH_GOOD ? ST77XX_GREEN :
                   (healthLight == HEALTH_FINE ? ST77XX_YELLOW : ST77XX_RED);
  header("MOOD", banner);

  tft.setTextSize(2);
  tft.setCursor(16, 28);
  tft.print(statusLabel(status));

  tft.setCursor(36, 58);
  tft.print(faceForStatus(status));

  tft.setTextSize(1);
  tft.setCursor(12, 96);
  tft.print("Plant says:");
  tft.setCursor(12, 112);
  tft.print(adviceLine1());
}

void drawAdvicePage() {
  header("ADVICE", ST77XX_MAGENTA);
  tft.setTextSize(1);
  tft.setCursor(8, 28); tft.print("Now: ");  tft.print(adviceLine1());
  tft.setCursor(8, 46); tft.print("Next: "); tft.print(adviceLine2());
  tft.setCursor(8, 74); tft.print("Score 0-100 from soil,");
  tft.setCursor(8, 88); tft.print("temperature, humidity");
  tft.setCursor(8, 108); tft.print("Serial logs every 2 sec");
}

void drawSensorError() {
  tft.fillScreen(ST77XX_BLACK);
  header("ERROR", ST77XX_RED);
  tft.setTextSize(2);
  tft.setCursor(18, 34); tft.print("DHT11 fail");
  tft.setTextSize(1);
  tft.setCursor(12, 72); tft.print("Check data, power");
  tft.setCursor(12, 86); tft.print("and ground wiring.");
}

void drawTftPage(bool forceRedraw) {
  if (!tftReady) return;
  if (!forceRedraw && millis() - lastTftFlip < TFT_ROTATE_MS) return;

  tft.fillScreen(ST77XX_BLACK);
  switch (tftPage) {
    case 0: drawScorePage(); break;
    case 1: drawReadingsPage(); break;
    case 2: drawMoodPage(); break;
    case 3: drawAdvicePage(); break;
  }
}

void emitReading(int soilPct, float tempC, float humidity, int score) {
  Serial.print("{\"soil\":");    Serial.print(soilPct);
  Serial.print(",\"temp\":");    Serial.print(tempC, 1);
  Serial.print(",\"humid\":");   Serial.print(humidity, 1);
  Serial.print(",\"status\":");  Serial.print(status);
  Serial.print(",\"problem\":"); Serial.print(problem);
  Serial.print(",\"score\":");   Serial.print(score);
  Serial.println("}");
}

void startupSequence() {
  setStatusLED(255, 0, 0);   setHealthLED(255, 0, 0);   delay(250);
  setStatusLED(255, 180, 0); setHealthLED(255, 220, 0); delay(250);
  setStatusLED(0, 255, 0);   setHealthLED(0, 255, 0);   delay(250);
  setStatusLED(0, 0, 0);     setHealthLED(0, 0, 0);

  if (tftReady) {
    tft.fillScreen(ST77XX_BLACK);
    header("PLANT ON", ST77XX_GREEN);
    tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
    tft.setTextSize(2);
    tft.setCursor(14, 42); tft.print("Smart Plant");
    tft.setCursor(24, 68); tft.print("Buddy Live");
    delay(900);
  }
}

void initTft() {
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1);
  tft.fillScreen(ST77XX_BLACK);
  tftReady = true;
}

void readSensors() {
  int soilRaw = analogRead(SOIL_PIN);
  int soilPct = constrain(map(soilRaw, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100), 0, 100);
  float humidity = dht.readHumidity();
  float tempC = dht.readTemperature();

  currentSoilPct = soilPct;
  currentHumidity = humidity;
  currentTempC = tempC;

  if (isnan(humidity) || isnan(tempC)) {
    setStatusLED(255, 0, 255);
    setHealthLED(255, 0, 0);
    overallScore = 0;
    drawSensorError();
    Serial.println("{\"error\":\"DHT11 read failed\"}");
    return;
  }

  problem = detectProblem(soilPct, tempC, humidity);
  status = detectStatus(soilPct, tempC, problem);
  healthLight = detectHealthLight(soilPct, tempC, humidity);
  overallScore = calculateOverallScore(soilPct, tempC, humidity, status, problem);

  updateStatusLED();
  updateHealthLED();
  updateBuzzer();
  drawTftPage(true);
  emitReading(soilPct, tempC, humidity, overallScore);
}

void setup() {
  Serial.begin(9600);
  dht.begin();

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  pinMode(HEALTH_LED_R, OUTPUT);
  pinMode(HEALTH_LED_G, OUTPUT);
  pinMode(HEALTH_LED_B, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  initTft();
  startupSequence();
  drawTftPage(true);
}

void loop() {
  unsigned long now = millis();

  if (now - lastRead >= READ_EVERY) {
    lastRead = now;
    readSensors();
  }

  if (tftReady && now - lastTftFlip >= TFT_ROTATE_MS) {
    lastTftFlip = now;
    tftPage = (tftPage + 1) % 4;
    drawTftPage(true);
  }
}
