import 'package:flutter/material.dart';

/// Lets code outside the widget tree (the push notification service, which
/// receives taps before any screen is necessarily mounted) navigate without
/// needing a BuildContext.
final rootNavigatorKey = GlobalKey<NavigatorState>();
