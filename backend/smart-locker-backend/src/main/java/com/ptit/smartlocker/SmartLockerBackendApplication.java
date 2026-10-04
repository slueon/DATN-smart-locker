package com.ptit.smartlocker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SmartLockerBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(SmartLockerBackendApplication.class, args);
    }

}
