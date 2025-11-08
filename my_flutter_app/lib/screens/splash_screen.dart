import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool _hasNavigated = false;

  void _maybeNavigate(AuthProvider authProvider) {
    if (_hasNavigated || !mounted) {
      return;
    }

    if (authProvider.isInitializing) {
      return;
    }

    _hasNavigated = true;

    final String targetRoute;
    if (authProvider.isAuthenticated) {
      targetRoute = authProvider.isStaff ? '/staff-home' : '/customer_home';
    } else {
      targetRoute = '/login';
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      Navigator.of(context).pushReplacementNamed(targetRoute);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Consumer<AuthProvider>(
        builder: (context, authProvider, child) {
          _maybeNavigate(authProvider);

          return const Center(child: CircularProgressIndicator());
        },
      ),
    );
  }
}
