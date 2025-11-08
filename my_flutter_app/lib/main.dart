import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'providers/language_provider.dart';
import 'providers/auth_provider.dart';
import 'l10n/app_localizations.dart';
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
import 'models/parked_car.dart';
import 'screens/parked_car_details_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
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
      ],
      child: Consumer2<LanguageProvider, AuthProvider>(
        builder: (context, languageProvider, authProvider, child) {
          return MaterialApp(
            title: 'Business Services',
            locale: languageProvider.currentLocale,
            supportedLocales: const [
              Locale('en'), // English
              Locale('fr'), // French
            ],
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            theme: ThemeData(
              colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepOrange),
              useMaterial3: true,
            ),
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
              '/parked-car-details': (context) {
                final parkedCar = ModalRoute.of(context)!.settings.arguments as ParkedCar;
                return ParkedCarDetailsScreen(parkedCar: parkedCar);
              },

              // Staff-only routes (hidden from customers)
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
