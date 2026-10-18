import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_widgets.dart';
import 'package_request_detail_screen.dart';
import 'package_request_form_screen.dart';

/// "My requests": the signed-in customer's package requests, newest first,
/// each opening its estimate page.
class MyPackageRequestsScreen extends StatefulWidget {
  const MyPackageRequestsScreen({super.key, this.service, this.customer});

  final PackageRequestService? service;

  /// Who is looking; the signed-in profile when null.
  final RequestCustomer? customer;

  @override
  State<MyPackageRequestsScreen> createState() =>
      _MyPackageRequestsScreenState();
}

class _MyPackageRequestsScreenState extends State<MyPackageRequestsScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();

  StreamSubscription<List<PackageRequest>>? _sub;
  Timer? _safety;
  String _uid = '';
  List<PackageRequest>? _requests;
  Object? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final customer =
        widget.customer ?? RequestCustomer.of(context, listen: false);
    final uid = customer?.uid ?? '';
    if (uid != _uid) {
      _uid = uid;
      _listen();
    }
  }

  void _listen() {
    _sub?.cancel();
    _safety?.cancel();
    _requests = null;
    _error = null;
    if (_uid.isEmpty) return;
    _safety = Timer(const Duration(seconds: 20), () {
      if (mounted && _requests == null && _error == null) {
        setState(
          () => _error = const RequestFailure(
            RequestRefusal(code: 'unavailable'),
          ),
        );
      }
    });
    _sub = _service
        .watchMine(_uid)
        .listen(
          (list) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _requests = list;
              _error = null;
            });
          },
          onError: (Object error) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() => _error = error);
          },
        );
  }

  @override
  void dispose() {
    _sub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  void _open(PackageRequest request) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageRequestDetailScreen(
          requestId: request.id,
          token: request.token,
          service: _service,
        ),
      ),
    );
  }

  void _newRequest() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageRequestFormScreen(
          service: _service,
          customer: widget.customer,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final requests = _requests;
    Widget body;
    if (_uid.isEmpty) {
      body = ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          LotEmptyState(
            key: const Key('my-requests-sign-in'),
            icon: Icons.person_outline,
            title: l10n.prqSignInTitle,
            hint: l10n.prqSignInHint,
          ),
          RequestPrimaryButton(
            label: l10n.prqSignIn,
            onTap: () => Navigator.of(context).pushNamed('/login'),
          ),
        ],
      );
    } else if (_error != null && requests == null) {
      body = Center(
        child: RequestLoadFailed(
          message: requestErrorText(l10n, _error!),
          onRetry: () => setState(_listen),
        ),
      );
    } else if (requests == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (requests.isEmpty) {
      body = ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          LotEmptyState(
            key: const Key('my-requests-empty'),
            icon: Icons.inventory_2_outlined,
            title: l10n.prqMineEmptyTitle,
            hint: l10n.prqMineEmptyHint,
          ),
        ],
      );
    } else {
      body = ListView.builder(
        key: const Key('my-requests-list'),
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.md,
          AppSpacing.lg,
          120,
        ),
        itemCount: requests.length,
        itemBuilder: (context, i) => RiseIn(
          key: ValueKey(requests[i].id),
          index: i,
          child: MyRequestCard(
            request: requests[i],
            onTap: () => _open(requests[i]),
          ),
        ),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(title: l10n.prqMyRequests),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(child: body),
                if (_uid.isNotEmpty)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: LotPrimaryBar(
                      key: const Key('my-requests-new'),
                      label: l10n.prqNewRequest,
                      icon: Icons.add,
                      onTap: _newRequest,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One of the customer's requests: code, business, where it stands, what
/// is in it and what it costs.
class MyRequestCard extends StatelessWidget {
  const MyRequestCard({super.key, required this.request, required this.onTap});

  final PackageRequest request;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final total = request.totalCents;
    final created = request.createdAt;
    return PressableScale(
      scale: 0.985,
      onTap: () {
        AppHaptics.selection();
        onTap();
      },
      child: RequestCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    request.businessName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Flexible(
                  child: RequestStatusPill(
                    status: request.status,
                    forCustomer: true,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              [
                request.code,
                requestPiecesSummary(l10n, countRequestPieces(request)),
                if (request.destinationCountryName.isNotEmpty)
                  request.destinationCountryName,
              ].where((s) => s.isNotEmpty).join(' · '),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
            if (total != null || created != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  [
                    if (total != null)
                      l10n.prqEstimateTotal(formatRequestCents(total)),
                    if (created != null)
                      l10n.prqSentOn(displayDate(created, locale)),
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
