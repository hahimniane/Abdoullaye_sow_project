import 'package:flutter/material.dart';

import '../services/saved_recipient_service.dart';

/// Receiver-name input that offers people this customer has shipped to
/// before (docs/PLAN-2026-08-backlog.md #7).
///
/// Typing a few letters of a past recipient's name offers their saved
/// profile; picking one fills in the rest (phone, WhatsApp-only flag). It
/// stays an ordinary text field otherwise - a first-time recipient is typed
/// normally and nothing is forced on the customer.
class RecipientNameField extends StatefulWidget {
  const RecipientNameField({
    super.key,
    required this.controller,
    required this.labelText,
    required this.onRecipientSelected,
    this.enabled = true,
    this.validator,
    this.service,
  });

  final TextEditingController controller;
  final String labelText;
  final ValueChanged<SavedRecipient> onRecipientSelected;
  final bool enabled;
  final String? Function(String?)? validator;
  final SavedRecipientService? service;

  @override
  State<RecipientNameField> createState() => _RecipientNameFieldState();
}

class _RecipientNameFieldState extends State<RecipientNameField> {
  late final SavedRecipientService _service =
      widget.service ?? SavedRecipientService();
  final _layerLink = LayerLink();
  final _focusNode = FocusNode();
  OverlayEntry? _overlay;
  List<SavedRecipient> _recipients = const [];
  List<SavedRecipient> _matches = const [];

  @override
  void initState() {
    super.initState();
    _service.recipients().listen((recipients) {
      if (!mounted) return;
      setState(() => _recipients = recipients);
    });
    widget.controller.addListener(_refreshMatches);
    _focusNode.addListener(() {
      if (!_focusNode.hasFocus) _hide();
    });
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refreshMatches);
    _hide();
    _focusNode.dispose();
    super.dispose();
  }

  void _refreshMatches() {
    final query = widget.controller.text;
    // An exact hit means they already picked it - no point re-offering.
    final matches = query.trim().isEmpty
        ? const <SavedRecipient>[]
        : _recipients
              .where((r) => r.matches(query))
              .where((r) => r.name.toLowerCase() != query.trim().toLowerCase())
              .take(4)
              .toList();
    if (matches.length == _matches.length &&
        matches.isNotEmpty == _matches.isNotEmpty) {
      final same = List.generate(
        matches.length,
        (i) => matches[i].id == _matches[i].id,
      ).every((it) => it);
      if (same) return;
    }
    setState(() => _matches = matches);
    if (matches.isEmpty || !_focusNode.hasFocus) {
      _hide();
    } else {
      _show();
    }
  }

  void _show() {
    _hide();
    final overlay = Overlay.of(context);
    _overlay = OverlayEntry(
      builder: (context) => Positioned(
        width: (context.findRenderObject() as RenderBox?)?.size.width ?? 280,
        child: CompositedTransformFollower(
          link: _layerLink,
          showWhenUnlinked: false,
          offset: const Offset(0, 58),
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final recipient in _matches)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.person_outline),
                    title: Text(recipient.name),
                    subtitle: Text(
                      [
                        recipient.phone,
                        if (recipient.countryName.isNotEmpty)
                          recipient.countryName,
                      ].join(' · '),
                    ),
                    onTap: () {
                      widget.controller.text = recipient.name;
                      widget.onRecipientSelected(recipient);
                      _hide();
                      _focusNode.unfocus();
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    overlay.insert(_overlay!);
  }

  void _hide() {
    _overlay?.remove();
    _overlay = null;
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _layerLink,
      child: TextFormField(
        controller: widget.controller,
        focusNode: _focusNode,
        enabled: widget.enabled,
        validator: widget.validator,
        decoration: InputDecoration(
          labelText: widget.labelText,
          prefixIcon: const Icon(Icons.person_outline),
        ),
      ),
    );
  }
}
