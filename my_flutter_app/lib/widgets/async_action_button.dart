import 'dart:async';

import 'package:flutter/material.dart';

enum AsyncActionButtonVariant { filled, outlined, text, elevated }

class AsyncActionButton extends StatefulWidget {
  const AsyncActionButton.filled({
    super.key,
    required this.onPressed,
    required this.label,
    this.loadingLabel,
    this.icon,
    this.style,
    this.autofocus = false,
  }) : variant = AsyncActionButtonVariant.filled;

  const AsyncActionButton.outlined({
    super.key,
    required this.onPressed,
    required this.label,
    this.loadingLabel,
    this.icon,
    this.style,
    this.autofocus = false,
  }) : variant = AsyncActionButtonVariant.outlined;

  const AsyncActionButton.text({
    super.key,
    required this.onPressed,
    required this.label,
    this.loadingLabel,
    this.icon,
    this.style,
    this.autofocus = false,
  }) : variant = AsyncActionButtonVariant.text;

  const AsyncActionButton.elevated({
    super.key,
    required this.onPressed,
    required this.label,
    this.loadingLabel,
    this.icon,
    this.style,
    this.autofocus = false,
  }) : variant = AsyncActionButtonVariant.elevated;

  final FutureOr<void> Function()? onPressed;
  final String label;
  final String? loadingLabel;
  final IconData? icon;
  final ButtonStyle? style;
  final bool autofocus;
  final AsyncActionButtonVariant variant;

  @override
  State<AsyncActionButton> createState() => _AsyncActionButtonState();
}

class _AsyncActionButtonState extends State<AsyncActionButton> {
  bool _isRunning = false;

  Future<void> _handlePressed() async {
    final onPressed = widget.onPressed;
    if (onPressed == null || _isRunning) return;

    setState(() => _isRunning = true);
    try {
      await onPressed();
    } finally {
      if (mounted) {
        setState(() => _isRunning = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final VoidCallback? onPressed = widget.onPressed == null || _isRunning
        ? null
        : () => unawaited(_handlePressed());
    final label = _isRunning
        ? widget.loadingLabel ?? widget.label
        : widget.label;
    final showLeading = _isRunning || widget.icon != null;

    final button = showLeading
        ? _buildIconButton(context, onPressed, label)
        : _buildTextButton(context, onPressed, label);

    return Semantics(button: true, label: label, child: button);
  }

  Widget _buildTextButton(
    BuildContext context,
    VoidCallback? onPressed,
    String label,
  ) {
    final child = Text(label);
    return switch (widget.variant) {
      AsyncActionButtonVariant.filled => FilledButton(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        child: child,
      ),
      AsyncActionButtonVariant.outlined => OutlinedButton(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        child: child,
      ),
      AsyncActionButtonVariant.text => TextButton(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        child: child,
      ),
      AsyncActionButtonVariant.elevated => ElevatedButton(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        child: child,
      ),
    };
  }

  Widget _buildIconButton(
    BuildContext context,
    VoidCallback? onPressed,
    String label,
  ) {
    final icon = _isRunning
        ? _LoadingIndicator(variant: widget.variant)
        : Icon(widget.icon!);
    final child = Text(label);

    return switch (widget.variant) {
      AsyncActionButtonVariant.filled => FilledButton.icon(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        icon: icon,
        label: child,
      ),
      AsyncActionButtonVariant.outlined => OutlinedButton.icon(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        icon: icon,
        label: child,
      ),
      AsyncActionButtonVariant.text => TextButton.icon(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        icon: icon,
        label: child,
      ),
      AsyncActionButtonVariant.elevated => ElevatedButton.icon(
        onPressed: onPressed,
        style: widget.style,
        autofocus: widget.autofocus,
        icon: icon,
        label: child,
      ),
    };
  }
}

class _LoadingIndicator extends StatelessWidget {
  const _LoadingIndicator({required this.variant});

  final AsyncActionButtonVariant variant;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = switch (variant) {
      AsyncActionButtonVariant.filled ||
      AsyncActionButtonVariant.elevated => colorScheme.onPrimary,
      AsyncActionButtonVariant.outlined ||
      AsyncActionButtonVariant.text => colorScheme.primary,
    };
    return SizedBox(
      width: 18,
      height: 18,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        valueColor: AlwaysStoppedAnimation<Color>(color),
      ),
    );
  }
}
