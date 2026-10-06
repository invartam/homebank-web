.PHONY: help install test web native desktop mac windows android android-release android-key android-key-info ios ios-adhoc sync-android sync-ios version release-check
ARCH ?= $(shell node -p process.arch)

help:
	@printf '%s\n' 'make install test web' 'make mac ARCH=arm64|x64' 'make windows ARCH=x64' 'make android                 # APK debug' 'make android-key             # Creer une cle de distribution' 'make android-key-info        # Afficher SHA-1 / SHA-256' 'make android-release         # APK + AAB signes' 'make ios                     # simulateur' 'make ios-adhoc               # IPA Ad Hoc signe' 'make version VERSION=0.2.0   # sans commit ni tag' 'make release-check'
install:
	npm ci
test:
	npm test
web:
	npm run build
native:
	npm run build:native
desktop:
	npm run desktop:dir -- $(ARCH)
mac:
	npm run desktop:mac -- $(ARCH)
windows:
	npm run desktop:windows -- $(ARCH)
android:
	npm run android:debug
android-release:
	npm run android:release
android-key:
	npm run android:key:generate
android-key-info:
	npm run android:key:info
ios:
	npm run ios:simulator
ios-adhoc:
	npm run ios:adhoc
sync-android:
	npm run native:sync:android
sync-ios:
	npm run native:sync:ios
version:
	npm run release:prepare -- $(VERSION)
release-check:
	npm run release:check
