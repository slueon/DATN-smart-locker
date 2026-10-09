package com.ptit.smartlocker.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.ArrayList;
import java.util.List;

@Configuration
public class CorsConfig {

    @Value("${app.cors.allowed-origins:http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000}")
    private String allowedOrigins;

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                List<String> originList = new ArrayList<>();
                if (allowedOrigins != null && !allowedOrigins.isBlank()) {
                    for (String origin : allowedOrigins.split(",")) {
                        String trimmed = origin.trim();
                        if (!trimmed.isEmpty()) {
                            originList.add(trimmed);
                        }
                    }
                }
                if (originList.isEmpty()) {
                    originList.add("http://localhost:5173");
                    originList.add("http://127.0.0.1:5173");
                    originList.add("http://localhost:3000");
                    originList.add("http://127.0.0.1:3000");
                }

                registry.addMapping("/**")
                        .allowedOrigins(originList.toArray(new String[0]))
                        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH")
                        .allowedHeaders("*")
                        .allowCredentials(true)
                        .maxAge(3600);
            }
        };
    }
}
