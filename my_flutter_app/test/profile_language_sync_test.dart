import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/services/profile_language_sync.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Stands in for AuthProvider: who is signed in (profile loaded) and what
/// their profile says.
class _FakeAccount extends ChangeNotifier {
  _FakeAccount({this.uid, this.saved});

  String? uid;
  String? saved;

  void set({String? uid, String? saved}) {
    this.uid = uid;
    this.saved = saved;
    notifyListeners();
  }
}

const _debounce = Duration(milliseconds: 600);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<String> writes;
  late _FakeAccount account;
  late LanguageProvider language;
  late ProfileLanguageSync sync;
  Object? failWith;
  var bound = false;

  Future<void> start(
    WidgetTester tester, {
    String? phoneChoice,
    String? uid,
    String? saved,
  }) async {
    SharedPreferences.setMockInitialValues({
      languagePreferenceKey: ?phoneChoice,
    });
    writes = [];
    failWith = null;
    account = _FakeAccount(uid: uid, saved: saved);
    language = LanguageProvider(deviceLocales: const [Locale('en')]);
    sync =
        ProfileLanguageSync(
          debounce: _debounce,
          save: (code) async {
            writes.add(code);
            final failure = failWith;
            if (failure != null) throw failure;
            // What AuthProvider.saveProfileLanguage does after a save.
            account.saved = code;
          },
        )..bind(
          language: language,
          account: account,
          uid: () => account.uid,
          savedLanguage: () => account.saved,
        );
    bound = true;
    await language.restored;
    await tester.pump();
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump(_debounce);
    await tester.pump();
  }

  tearDown(() {
    if (bound) sync.dispose();
    bound = false;
  });

  testWidgets('switching to French saves "fr" on the profile, once', (
    tester,
  ) async {
    await start(tester, uid: 'u1', saved: 'en');
    language.setLanguage('fr');
    // Debounced: nothing goes out straight away.
    await tester.pump(const Duration(milliseconds: 100));
    expect(writes, isEmpty);
    await settle(tester);
    expect(writes, ['fr']);
    // Later account notifications (a profile refresh) send nothing more.
    account.set(uid: 'u1', saved: 'fr');
    await settle(tester);
    expect(writes, ['fr']);
  });

  testWidgets('a language the profile already has is not written', (
    tester,
  ) async {
    await start(tester, uid: 'u1', saved: 'en');
    await settle(tester);
    account.set(uid: 'u1', saved: 'en');
    await settle(tester);
    language.setLanguage('en');
    await settle(tester);
    expect(writes, isEmpty);
  });

  testWidgets('switching away and back before the save writes nothing', (
    tester,
  ) async {
    await start(tester, uid: 'u1', saved: 'en');
    language.setLanguage('fr');
    await tester.pump(const Duration(milliseconds: 200));
    language.setLanguage('en');
    await settle(tester);
    expect(writes, isEmpty);
  });

  testWidgets('signed out: nothing is written', (tester) async {
    await start(tester);
    language.setLanguage('fr');
    await settle(tester);
    expect(writes, isEmpty);

    // Signing in afterwards saves what the app shows.
    account.set(uid: 'u1', saved: null);
    await settle(tester);
    expect(writes, ['fr']);
  });

  testWidgets('signing out before the debounce ends cancels the save', (
    tester,
  ) async {
    await start(tester, uid: 'u1', saved: 'en');
    language.setLanguage('fr');
    await tester.pump(const Duration(milliseconds: 100));
    account.set(uid: null, saved: null);
    await settle(tester);
    expect(writes, isEmpty);
  });

  testWidgets('app start: a French choice made before this existed is '
      'saved once the phone\'s choice is read', (tester) async {
    // The phone remembers French; the profile has no language yet; the
    // device itself is English. The device language must never be written.
    await start(tester, phoneChoice: 'fr', uid: 'u1', saved: null);
    expect(language.isFrench, isTrue);
    await settle(tester);
    expect(writes, ['fr']);
  });

  testWidgets('sign-in as another account checks that account too', (
    tester,
  ) async {
    await start(tester, phoneChoice: 'fr', uid: 'u1', saved: 'fr');
    await settle(tester);
    expect(writes, isEmpty);
    account.set(uid: null, saved: null);
    account.set(uid: 'u2', saved: 'en');
    await settle(tester);
    expect(writes, ['fr']);
  });

  testWidgets('a failed save is only logged and not retried on every '
      'notification', (tester) async {
    await start(tester, uid: 'u1', saved: 'en');
    failWith = Exception('offline');
    language.setLanguage('fr');
    await settle(tester);
    expect(writes, ['fr']);
    account.set(uid: 'u1', saved: 'en');
    await settle(tester);
    expect(writes, ['fr']);
    expect(tester.takeException(), isNull);
  });

  test('the app runs the sync under its providers', () {
    final main = File('lib/main.dart').readAsStringSync();
    expect(main, contains('ProfileLanguageSyncHost(child: child!)'));
    final host = File(
      'lib/widgets/profile_language_sync_host.dart',
    ).readAsStringSync();
    expect(host, contains('save: auth.saveProfileLanguage'));
    expect(host, contains('uid: () => auth.loadedProfileUid'));
    expect(host, contains('savedLanguage: () => auth.profileLanguage'));
  });
}
