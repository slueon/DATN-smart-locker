package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.entity.Product;
import com.ptit.smartlocker.repository.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductRepository productRepository;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Product>>> getAllProducts() {
        List<Product> products = productRepository.findAll();
        return ResponseEntity.ok(ApiResponse.ok(products));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Product>> getProductById(@PathVariable Long id) {
        return productRepository.findById(id)
                .map(p -> ResponseEntity.ok(ApiResponse.ok(p)))
                .orElse(ResponseEntity.badRequest().body(ApiResponse.error("Sản phẩm không tồn tại")));
    }
}
