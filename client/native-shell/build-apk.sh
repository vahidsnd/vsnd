#!/usr/bin/env bash
# Builds a standalone TEST apk (demo ads, sandbox purchases, offline profile; online if a server URL is set)
# without Gradle. Needs: JDK, aapt, dalvik-exchange (dx), zipalign, apksigner, and an android.jar (API 34/35).
#   ANDROID_JAR=/path/android.jar ./build-apk.sh
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR=${ANDROID_JAR:?set ANDROID_JAR to a platform android.jar}
OUT=build; rm -rf $OUT; mkdir -p $OUT/classes $OUT/assets/www $OUT/res
(cd .. && npx vite build --mode demo >/dev/null)
cp -r ../dist/. $OUT/assets/www/
cp -r res/. $OUT/res/
javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d $OUT/classes $(find src -name '*.java') 2>&1 | grep -v "warning" || true
dalvik-exchange --dex --min-sdk-version=24 --output=$OUT/classes.dex $OUT/classes
aapt package -f -0 arsc -M AndroidManifest.xml -S $OUT/res -A $OUT/assets -I "$ANDROID_JAR" -F $OUT/unsigned.apk
(cd $OUT && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk
KS=${KEYSTORE:-$HOME/.neonbrawl-test.keystore}
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias test -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Neon Brawl Test" >/dev/null 2>&1
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out $OUT/NeonBrawl-test.apk $OUT/aligned.apk
apksigner verify $OUT/NeonBrawl-test.apk && ls -la $OUT/NeonBrawl-test.apk
