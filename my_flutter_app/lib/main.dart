import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'firebase_environment_options.dart';
import 'firebase_emulator_config.dart';
import 'navigation/app_navigator.dart';
import 'providers/language_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/app_gate_provider.dart';
import 'services/push_notification_service.dart';
import 'theme/app_theme.dart';
import 'l10n/app_localizations.dart';
import 'widgets/app_gate_boundary.dart';
import 'widgets/app_snackbars.dart';
import 'widgets/biometric_lock_gate.dart';
import 'screens/splash_screen.dart';
import 'screens/customer_home_screen.dart';
import 'screens/staff_home_screen.dart';
import 'screens/home_menu.dart';
import 'screens/business_record_screen.dart';
import 'screens/business_reviews_screen.dart';
import 'screens/business_transport_screen.dart';
import 'services/business_service_overview.dart';
import 'screens/park_car_screen.dart';
import 'screens/send_barrel_screen.dart';
import 'screens/open_barrels_screen.dart';
import 'screens/send_freight_screen.dart';
import 'screens/customize_navbar_screen.dart';
import 'screens/transport_car_screen.dart';
import 'screens/request_transport_screen.dart';
import 'screens/sell_cars_screen.dart';
import 'screens/tracking_screen.dart';
import 'screens/login_screen.dart';
import 'screens/forgot_password_screen.dart';
import 'screens/user_management_screen.dart';
import 'screens/add_staff_screen.dart';
import 'screens/signup_screen.dart';
import 'screens/my_purchases_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/review_composer_screen.dart';
import 'screens/staff_purchase_management_screen.dart';
import 'screens/destination_countries_screen.dart';
import 'screens/account_profile_screen.dart';
import 'screens/phone_verification_screen.dart';
import 'screens/business_management_screen.dart';
import 'screens/business_profile_screen.dart';
import 'screens/business_registration_screen.dart';
import 'screens/favorite_cars_screen.dart';
import 'screens/support_inbox_screen.dart';
import 'screens/support_thread_screen.dart';
import 'models/parked_car.dart';
import 'screens/parked_car_details_screen.dart';
import 'models/barrel_shipment.dart';
import 'screens/barrel_shipment_details_screen.dart';
import 'models/transport_request.dart';
import 'screens/transport_request_details_screen.dart';
import 'screens/freight_quote_details_screen.dart';
import 'services/notification_routing.dart';
import 'services/stripe_config_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: firebaseOptionsForRuntime(
      FirebaseEnvironmentOptions.currentPlatform,
    ),
  );
  await connectFirebaseEmulatorsIfRequested();

  // Everything past Firebase itself is optional to the first frame, and none
  // of it used to be. A device that cannot finish one of these - App Check
  // attesting a build Apple has not distributed, an APNs token on a device
  // with notifications refused - held the splash screen for as long as the
  // app was open, because each one was awaited before runApp.
  //
  // App Check still runs first and is still waited for: calls made before it
  // activates go out unattested and are rejected. It is bounded now, so a
  // device that cannot attest starts the app instead of hanging it.
  await _startupStep('Crashlytics', initializeFirebaseCrashlytics);
  await _startupStep('App Check', initializeFirebaseAppCheck);

  // Neither of these is read before a screen asks for it, so they finish in
  // the background rather than standing between the customer and the app.
  unawaited(_startupStep('Stripe', StripeConfigService.ensureConfigured));
  unawaited(
    _startupStep('push notifications',
        PushNotificationService.instance.initialize),
  );

  runApp(const MyApp());
}

/// Runs one optional startup step without letting it hold the app back.
///
/// A step that fails leaves the app short of that one capability; a step that
/// never returns used to leave the customer looking at a logo.
Future<void> _startupStep(String name, Future<void> Function() step) async {
  try {
    await step().timeout(const Duration(seconds: 8));
  } on TimeoutException {
    debugPrint('Startup: $name timed out; continuing without it.');
  } catch (error) {
    debugPrint('Startup: $name unavailable ($error); continuing without it.');
  }
}

Future<void> initializeFirebaseAppCheck() async {
  const webSiteKey = String.fromEnvironment(
    'FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY',
  );
  const debugToken = String.fromEnvironment('FIREBASE_APP_CHECK_DEBUG_TOKEN');

  if (!kDebugMode && debugToken.trim().isNotEmpty) {
    throw StateError(
      'FIREBASE_APP_CHECK_DEBUG_TOKEN must not be set outside debug builds.',
    );
  }

  if (!kIsWeb &&
      defaultTargetPlatform != TargetPlatform.android &&
      defaultTargetPlatform != TargetPlatform.iOS &&
      defaultTargetPlatform != TargetPlatform.macOS) {
    if (!kDebugMode) {
      throw UnsupportedError(
        'Firebase App Check production attestation is not supported on '
        '${defaultTargetPlatform.name}.',
      );
    }
    debugPrint(
      'Firebase App Check skipped on unsupported debug platform '
      '${defaultTargetPlatform.name}.',
    );
    return;
  }

  if (kIsWeb && !kDebugMode && webSiteKey.trim().isEmpty) {
    throw StateError(
      'FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY is required for release web builds.',
    );
  }

  await FirebaseAppCheck.instance.activate(
    providerWeb: kDebugMode
        ? WebDebugProvider(
            debugToken: debugToken.trim().isEmpty ? null : debugToken.trim(),
          )
        : ReCaptchaEnterpriseProvider(webSiteKey.trim()),
    providerAndroid: kDebugMode
        ? AndroidDebugProvider(
            debugToken: debugToken.trim().isEmpty ? null : debugToken.trim(),
          )
        : const AndroidPlayIntegrityProvider(),
    providerApple: kDebugMode
        ? AppleDebugProvider(
            debugToken: debugToken.trim().isEmpty ? null : debugToken.trim(),
          )
        : const AppleAppAttestWithDeviceCheckFallbackProvider(),
  );
  await FirebaseAppCheck.instance.setTokenAutoRefreshEnabled(true);
}

bool supportsFirebaseCrashlytics(bool isWeb, TargetPlatform platform) {
  return !isWeb &&
      (platform == TargetPlatform.android ||
          platform == TargetPlatform.iOS ||
          platform == TargetPlatform.macOS);
}

Future<void> initializeFirebaseCrashlytics() async {
  if (!supportsFirebaseCrashlytics(kIsWeb, defaultTargetPlatform)) return;

  final crashlytics = FirebaseCrashlytics.instance;
  await crashlytics.setCrashlyticsCollectionEnabled(!kDebugMode);
  final previousPlatformErrorHandler = PlatformDispatcher.instance.onError;

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    if (!kDebugMode) crashlytics.recordFlutterFatalError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    if (kDebugMode) {
      return previousPlatformErrorHandler?.call(error, stack) ?? false;
    }
    crashlytics.recordError(error, stack, fatal: true);
    return true;
  };
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (context) => LanguageProvider()),
        ChangeNotifierProvider(create: (context) => AuthProvider()),
        ChangeNotifierProvider(
          create: (context) => useFirebaseEmulators
              ? AppGateProvider.localEmulator()
              : AppGateProvider(),
        ),
      ],
      child: Consumer2<LanguageProvider, AuthProvider>(
        builder: (context, languageProvider, authProvider, child) {
          return MaterialApp(
            title: 'Laawol Digital',
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            locale: languageProvider.currentLocale,
            supportedLocales: const [Locale('en'), Locale('fr')],
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            theme: AppTheme.light,
            themeMode: ThemeMode.light,
            builder: (context, child) {
              return AppGateBoundary(
                child: BiometricLockGate(child: child ?? const SizedBox()),
              );
            },
            initialRoute: '/splash',
            routes: {
              '/splash': (context) => const SplashScreen(),
              '/': (context) => const CustomerHomeScreen(),
              '/login': (context) => const LoginScreen(),
              '/signup': (context) => const SignUpScreen(),
              '/forgot-password': (context) => const ForgotPasswordScreen(),
              '/customer_home': (context) => const CustomerHomeScreen(),
              '/park': (context) => const ParkCarScreen(),
              '/barrel': (context) => const SendBarrelScreen(),
              '/open-barrels': (context) => const OpenBarrelsScreen(),
              '/send-freight': (context) => const SendFreightScreen(),
              '/customize-navbar': (context) => const CustomizeNavbarScreen(),
              '/transport': (context) => const TransportCarScreen(),
              '/request-transport': (context) => const RequestTransportScreen(),
              '/sell': (context) => const SellCarsScreen(showBackButton: true),
              '/tracking': (context) {
                final rawArgs = ModalRoute.of(context)!.settings.arguments;
                final args = rawArgs is TrackingScreenArguments
                    ? rawArgs
                    : null;
                return TrackingScreen(
                  showBackButton: true,
                  focusShipmentId: args?.shipmentId,
                );
              },
              '/my-purchases': (context) =>
                  const MyPurchasesScreen(showBackButton: true),
              // A viewing is an appointment, not a purchase, so buyers reach
              // it from its own destination rather than through a list of
              // money they have paid.
              '/my-viewings': (context) => const MyPurchasesScreen(
                showBackButton: true,
                scope: PurchaseListScope.viewings,
              ),
              '/orders': (context) {
                final rawArgs = ModalRoute.of(context)!.settings.arguments;
                return OrdersScreen(
                  showBackButton: true,
                  initialArgs: rawArgs is OrdersScreenArguments ? rawArgs : null,
                );
              },
              // Named so a notification about a price can open it. Before
              // this the screen existed only as a push from the form that
              // created the request, which left a customer who closed it -
              // or who tapped the notification - with no route back to the
              // price they were waiting for.
              '/freight-quote': (context) {
                final rawArgs = ModalRoute.of(context)!.settings.arguments;
                final args = rawArgs is FreightQuoteScreenArguments
                    ? rawArgs
                    : null;
                if (args == null) {
                  return const OrdersScreen(showBackButton: true);
                }
                return FreightQuoteDetailsScreen(
                  requestId: args.requestId,
                  trackingCode: args.trackingCode,
                );
              },
              '/leave-review': (context) {
                final args =
                    ModalRoute.of(context)!.settings.arguments
                        as ReviewComposerArguments;
                return ReviewComposerScreen(arguments: args);
              },
              '/purchase-management': (context) =>
                  const StaffPurchaseManagementScreen(),
              '/destination-countries': (context) =>
                  const DestinationCountriesScreen(),
              '/account-profile': (context) => const AccountProfileScreen(),
              '/verify-phone': (context) {
                final args =
                    ModalRoute.of(context)!.settings.arguments
                        as PhoneVerificationArguments?;
                return PhoneVerificationScreen(
                  returnToSharedBarrels: args?.returnToSharedBarrels ?? false,
                );
              },
              '/favorite-cars': (context) => const FavoriteCarsScreen(),
              '/businesses': (context) => const BusinessManagementScreen(),
              '/business-profile': (context) => const BusinessProfileScreen(),
              '/business-register': (context) =>
                  const BusinessRegistrationScreen(),
              '/parked-car-details': (context) {
                final parkedCar =
                    ModalRoute.of(context)!.settings.arguments as ParkedCar;
                return ParkedCarDetailsScreen(parkedCar: parkedCar);
              },
              '/barrel-shipment-details': (context) {
                final shipment =
                    ModalRoute.of(context)!.settings.arguments
                        as BarrelShipment;
                return BarrelShipmentDetailsScreen(shipment: shipment);
              },
              '/transport-request-details': (context) {
                final request =
                    ModalRoute.of(context)!.settings.arguments
                        as TransportRequest;
                return TransportRequestDetailsScreen(request: request);
              },
              '/staff-home': (context) => const StaffHomeScreen(),
              '/home-menu': (context) => const HomeMenu(),
              // Business destinations for notification taps.
              '/business-home': (context) {
                final args = ModalRoute.of(context)!.settings.arguments
                    as BusinessHomeArguments?;
                return HomeMenu(
                  initialCategory: serviceCategoryFromKey(args?.category),
                  showBackButton: true,
                );
              },
              '/business-record': (context) {
                final args = ModalRoute.of(context)!.settings.arguments
                    as BusinessRecordArguments;
                return BusinessRecordScreen(arguments: args);
              },
              '/business-transport': (context) {
                final businessId =
                    context.read<AuthProvider>().businessId ?? '';
                return BusinessTransportScreen(businessId: businessId);
              },
              '/business-reviews': (context) {
                final businessId =
                    context.read<AuthProvider>().businessId ?? '';
                return BusinessReviewsScreen(businessId: businessId);
              },
              '/user-management': (context) => const UserManagementScreen(),
              '/add-staff': (context) => const AddStaffScreen(),
              '/business-support': (context) =>
                  const SupportInboxScreen.business(),
              '/admin-support': (context) => const SupportInboxScreen.admin(),
              '/support': (context) {
                final args =
                    ModalRoute.of(context)!.settings.arguments
                        as SupportInboxArguments?;
                if (args == null) {
                  return const SupportInboxScreen.customer();
                }
                return SupportInboxScreen(scope: args.scope);
              },
              '/support-thread': (context) {
                final caseId =
                    ModalRoute.of(context)!.settings.arguments as String;
                return SupportThreadScreen(caseId: caseId);
              },
            },
          );
        },
      ),
    );
  }
}
