import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'Android release build memory stays within the development Mac budget',
    () {
      final properties = File('android/gradle.properties').readAsStringSync();

      expect(properties, contains('org.gradle.jvmargs=-Xmx3G'));
      expect(properties, contains('-XX:MaxMetaspaceSize=1G'));
      expect(properties, contains('kotlin.daemon.jvmargs=-Xmx1536m'));
      expect(properties, contains('org.gradle.workers.max=2'));
      expect(properties, isNot(contains('-Xmx8G')));
    },
  );
}
