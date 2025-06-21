import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class UserManagementScreen extends StatefulWidget {
  const UserManagementScreen({super.key});

  @override
  State<UserManagementScreen> createState() => _UserManagementScreenState();
}

class _UserManagementScreenState extends State<UserManagementScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  Future<void> _updateUserRole(String userId, String newRole) async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    try {
      await authProvider.updateUserRole(userId, newRole);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('User role updated to $newRole'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to update user role: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('User Management'),
        backgroundColor: Colors.deepOrange,
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: _firestore.collection('users').snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}'));
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(child: Text('No users found.'));
          }

          final users = snapshot.data!.docs;

          return ListView.builder(
            itemCount: users.length,
            itemBuilder: (context, index) {
              final user = users[index];
              final userData = user.data() as Map<String, dynamic>;

              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                elevation: 2,
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: Colors.deepOrange,
                    child: Text(
                      userData['email']?.substring(0, 1).toUpperCase() ?? 'U',
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                  title: Text(
                    userData['email'] ?? 'No email',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text('Role: ${userData['role'] ?? 'customer'}'),
                  trailing: PopupMenuButton<String>(
                    onSelected: (String newRole) {
                      _updateUserRole(user.id, newRole);
                    },
                    itemBuilder:
                        (BuildContext context) => <PopupMenuEntry<String>>[
                          const PopupMenuItem<String>(
                            value: 'customer',
                            child: Text('Set as Customer'),
                          ),
                          const PopupMenuItem<String>(
                            value: 'staff',
                            child: Text('Set as Staff'),
                          ),
                          const PopupMenuItem<String>(
                            value: 'admin',
                            child: Text('Set as Admin'),
                          ),
                        ],
                    icon: const Icon(Icons.more_vert),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
