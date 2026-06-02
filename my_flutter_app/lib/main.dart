import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'firebase_options.dart';
import 'providers/language_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';
import 'providers/app_gate_provider.dart';
import 'theme/app_theme.dart';
import 'l10n/app_localizations.dart';
import 'widgets/app_gate_boundary.dart';
import 'screens/splash_screen.dart';
import 'screens/customer_home_screen.dart';
import 'screens/staff_home_screen.dart';
import 'screens/home_menu.dart';
import 'screens/park_car_screen.dart';
import 'screens/send_barrel_screen.dart';
import 'screens/transport_car_screen.dart';
import 'screens/sell_cars_screen.dart';
import 'screens/tracking_screen.dart';
import 'screens/login_screen.dart';
import 'screens/forgot_password_screen.dart';
import 'screens/user_management_screen.dart';
import 'screens/add_staff_screen.dart';
import 'screens/signup_screen.dart';
import 'screens/my_purchases_screen.dart';
import 'screens/staff_purchase_management_screen.dart';
import 'screens/destination_countries_screen.dart';
import 'screens/account_profile_screen.dart';
import 'screens/business_management_screen.dart';
import 'screens/business_profile_screen.dart';
import 'screens/business_registration_screen.dart';
import 'screens/wallet_screen.dart';
import 'models/parked_car.dart';
import 'screens/parked_car_details_screen.dart';
import 'models/barrel_shipment.dart';
import 'screens/barrel_shipment_details_screen.dart';
import 'models/transport_request.dart';
import 'screens/transport_request_details_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  const stripePublishableKey = String.fromEnvironment('STRIPE_PUBLISHABLE_KEY');
  if (stripePublishableKey.isNotEmpty) {
    Stripe.publishableKey = stripePublishableKey;
    await Stripe.instance.applySettings();
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (context) => LanguageProvider()),
        ChangeNotifierProvider(create: (context) => AuthProvider()),
        ChangeNotifierProvider(create: (context) => ThemeProvider()),
        ChangeNotifierProvider(create: (context) => AppGateProvider()),
      ],
      child: Consumer3<LanguageProvider, AuthProvider, ThemeProvider>(
        builder:
            (context, languageProvider, authProvider, themeProvider, child) {
              return MaterialApp(
                title: 'Keren Auto Sales',
                locale: languageProvider.currentLocale,
                supportedLocales: const [Locale('en'), Locale('fr')],
                localizationsDelegates: const [
                  AppLocalizations.delegate,
                  GlobalMaterialLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                  GlobalCupertinoLocalizations.delegate,
                ],
                theme: AppTheme.light,
                darkTheme: AppTheme.dark,
                themeMode: themeProvider.themeMode,
                builder: (context, child) {
                  return AppGateBoundary(child: child ?? const SizedBox());
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
                  '/transport': (context) => const TransportCarScreen(),
                  '/sell': (context) => const SellCarsScreen(),
                  '/tracking': (context) => const TrackingScreen(),
                  '/my-purchases': (context) => const MyPurchasesScreen(),
                  '/purchase-management': (context) =>
                      const StaffPurchaseManagementScreen(),
                  '/destination-countries': (context) =>
                      const DestinationCountriesScreen(),
                  '/account-profile': (context) => const AccountProfileScreen(),
                  '/wallet': (context) => const WalletScreen(),
                  '/businesses': (context) => const BusinessManagementScreen(),
                  '/business-profile': (context) =>
                      const BusinessProfileScreen(),
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
                  '/user-management': (context) => const UserManagementScreen(),
                  '/add-staff': (context) => const AddStaffScreen(),
                },
              );
            },
      ),
    );
  }
}
