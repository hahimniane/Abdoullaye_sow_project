import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/support_case.dart';
import '../services/support_service.dart';
import '../theme/app_colors.dart';
import 'async_action_button.dart';

class SupportEntryButton extends StatefulWidget {
  const SupportEntryButton({
    super.key,
    required this.relatedCollection,
    required this.relatedId,
    required this.subject,
    required this.relatedLabel,
    this.compact = false,
    this.supportRepository,
  });

  final String relatedCollection;
  final String relatedId;
  final String subject;
  final String relatedLabel;
  final bool compact;
  final SupportRepository? supportRepository;

  @override
  State<SupportEntryButton> createState() => _SupportEntryButtonState();
}

class _SupportEntryButtonState extends State<SupportEntryButton> {
  late final SupportRepository _supportService;

  @override
  void initState() {
    super.initState();
    _supportService = widget.supportRepository ?? SupportService();
  }

  Future<void> _openSupport() async {
    final l10n = AppLocalizations.of(context)!;
    final message = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _SupportStartSheet(
        subject: widget.subject,
        relatedLabel: widget.relatedLabel,
      ),
    );
    if (!mounted || message == null) return;
    try {
      final caseId = await _supportService.createOrOpenCase(
        SupportCaseOpenRequest(
          relatedCollection: widget.relatedCollection,
          relatedId: widget.relatedId,
          subject: widget.subject,
          message: message,
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.supportCaseOpened)));
      Navigator.pushNamed(context, '/support-thread', arguments: caseId);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${l10n.supportActionFailed}: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (widget.compact) {
      return AsyncActionButton.outlined(
        onPressed: _openSupport,
        label: l10n.getHelp,
        loadingLabel: l10n.openingSupport,
        icon: Icons.support_agent_outlined,
      );
    }
    return AsyncActionButton.filled(
      onPressed: _openSupport,
      label: l10n.openSupport,
      loadingLabel: l10n.openingSupport,
      icon: Icons.support_agent_outlined,
    );
  }
}

class BusinessPlatformSupportButton extends StatefulWidget {
  const BusinessPlatformSupportButton({
    super.key,
    required this.businessId,
    this.businessName = '',
    this.compact = false,
    this.supportRepository,
  });

  final String businessId;
  final String businessName;
  final bool compact;
  final SupportRepository? supportRepository;

  @override
  State<BusinessPlatformSupportButton> createState() =>
      _BusinessPlatformSupportButtonState();
}

class _BusinessPlatformSupportButtonState
    extends State<BusinessPlatformSupportButton> {
  late final SupportRepository _supportService;

  @override
  void initState() {
    super.initState();
    _supportService = widget.supportRepository ?? SupportService();
  }

  Future<void> _openSupport() async {
    final l10n = AppLocalizations.of(context)!;
    final request = await showModalBottomSheet<_BusinessSupportDraft>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          _BusinessSupportStartSheet(businessName: widget.businessName),
    );
    if (!mounted || request == null) return;
    try {
      final caseId = await _supportService.createBusinessPlatformCase(
        businessId: widget.businessId,
        subject: request.subject,
        message: request.message,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.supportCaseOpened)));
      Navigator.pushNamed(context, '/support-thread', arguments: caseId);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${l10n.supportActionFailed}: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (widget.compact) {
      return AsyncActionButton.outlined(
        onPressed: _openSupport,
        label: l10n.businessSupportAskAdmin,
        loadingLabel: l10n.openingSupport,
        icon: Icons.admin_panel_settings_outlined,
      );
    }
    return AsyncActionButton.filled(
      onPressed: _openSupport,
      label: l10n.businessSupportAskAdmin,
      loadingLabel: l10n.openingSupport,
      icon: Icons.admin_panel_settings_outlined,
    );
  }
}

class _SupportStartSheet extends StatefulWidget {
  const _SupportStartSheet({required this.subject, required this.relatedLabel});

  final String subject;
  final String relatedLabel;

  @override
  State<_SupportStartSheet> createState() => _SupportStartSheetState();
}

class _SupportStartSheetState extends State<_SupportStartSheet> {
  final TextEditingController _messageController = TextEditingController();

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.pop(context, _messageController.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.rule,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(widget.subject, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text(
            widget.relatedLabel,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          Text(
            l10n.supportOpenFromTransaction,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _messageController,
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(
              labelText: l10n.writeSupportMessage,
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          AsyncActionButton.filled(
            onPressed: _submit,
            label: l10n.openSupport,
            loadingLabel: l10n.openingSupport,
            icon: Icons.chat_bubble_outline,
          ),
        ],
      ),
    );
  }
}

class _BusinessSupportDraft {
  const _BusinessSupportDraft({required this.subject, required this.message});

  final String subject;
  final String message;
}

class _BusinessSupportStartSheet extends StatefulWidget {
  const _BusinessSupportStartSheet({required this.businessName});

  final String businessName;

  @override
  State<_BusinessSupportStartSheet> createState() =>
      _BusinessSupportStartSheetState();
}

class _BusinessSupportStartSheetState
    extends State<_BusinessSupportStartSheet> {
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  String? _subjectError;
  String? _messageError;

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  void _submit() {
    final l10n = AppLocalizations.of(context)!;
    final subject = _subjectController.text.trim();
    final message = _messageController.text.trim();
    setState(() {
      _subjectError = subject.isEmpty
          ? l10n.businessSupportSubjectRequired
          : null;
      _messageError = message.isEmpty ? l10n.supportMessageRequired : null;
    });
    if (subject.isEmpty || message.isEmpty) return;
    Navigator.pop(
      context,
      _BusinessSupportDraft(subject: subject, message: message),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    final businessName = widget.businessName.trim();
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.rule,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            l10n.businessSupportTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (businessName.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              businessName,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: AppColors.muted),
            ),
          ],
          const SizedBox(height: 12),
          Text(
            l10n.businessSupportSubtitle,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _subjectController,
            textInputAction: TextInputAction.next,
            onChanged: (_) {
              if (_subjectError != null) {
                setState(() => _subjectError = null);
              }
            },
            decoration: InputDecoration(
              labelText: l10n.businessSupportSubject,
              errorText: _subjectError,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageController,
            minLines: 3,
            maxLines: 6,
            onChanged: (_) {
              if (_messageError != null) {
                setState(() => _messageError = null);
              }
            },
            decoration: InputDecoration(
              labelText: l10n.writeSupportMessage,
              alignLabelWithHint: true,
              errorText: _messageError,
            ),
          ),
          const SizedBox(height: 16),
          AsyncActionButton.filled(
            onPressed: _submit,
            label: l10n.openSupport,
            loadingLabel: l10n.openingSupport,
            icon: Icons.chat_bubble_outline,
          ),
        ],
      ),
    );
  }
}
