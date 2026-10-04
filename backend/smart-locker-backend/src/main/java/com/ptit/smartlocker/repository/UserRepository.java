package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    Optional<User> findByPhone(String phone);
    boolean existsByUsername(String username);
    boolean existsByPhone(String phone);
    List<User> findByRole(String role);
}
