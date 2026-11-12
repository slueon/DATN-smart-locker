package com.ptit.smartlocker.config;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Component
public class LockerDataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(LockerDataSeeder.class);

    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository scheduleRepository;
    private final OrderRepository orderRepository;

    @org.springframework.beans.factory.annotation.Value("${app.seed.sample-orders:false}")
    private boolean seedSampleOrders;

    public LockerDataSeeder(LockerRepository lockerRepository,
                            CompartmentRepository compartmentRepository,
                            LockerSlotScheduleRepository scheduleRepository,
                            OrderRepository orderRepository) {
        this.lockerRepository = lockerRepository;
        this.compartmentRepository = compartmentRepository;
        this.scheduleRepository = scheduleRepository;
        this.orderRepository = orderRepository;
    }

    /**
     * GĐ12 — {@code isVirtual}: {@code true} = tủ khai báo trong CSDL, KHÔNG có thiết bị thật.
     *
     * <p>Phần cứng thật chỉ có 1 tủ: thiết bị {@code Tu_1} gửi nhịp tim cho
     * {@code LOCKER_HN_01}. 9 tủ còn lại là dữ liệu mẫu nên không bao giờ có nhịp tim; đánh dấu
     * chúng là tủ ảo để giao diện hiện "Online (tủ ảo)" thay vì "Mất kết nối" sai sự thật.
     *
     * <p><b>KHÔNG set {@code lastHeartbeat} cho tủ ảo.</b> Cột đó phải phản ánh sự thật "chưa
     * từng gửi nhịp tim"; nếu bịa giá trị cho đẹp thì ta đang giả mạo dữ liệu thiết bị và không
     * ai còn phân biệt được tủ thật với tủ khai báo.
     */
    record LockerSeed(String id, String name, String address, double lat, double lng, String status,
                      int totalComps, int[][] comps, boolean isVirtual) {}

    @Override
    @Transactional
    public void run(String... args) {
        log.info(">>> Khởi chạy LockerDataSeeder: Tự động kiểm tra và đồng bộ mạng lưới 10 điểm tủ GIS...");

        List<LockerSeed> seeds = List.of(
            new LockerSeed("LOCKER_HN_01", "Tủ Giao Nhận KTX A1 (Trụ Sở PTIT)", "Sảnh Tầng 1, KTX A1, Học viện CNBCVT, Km10 Nguyễn Trãi, Q. Hà Đông", 20.9808, 105.7876, "ONLINE", 2, new int[][]{{1, 18}, {2, 19}}, false),
            new LockerSeed("LOCKER_HN_02", "Tủ Giao Nhận Đại Học Hà Nội (HANU)", "Cổng Chính ĐH Hà Nội, Km9 Đường Nguyễn Trãi, P. Trung Văn, Q. Nam Từ Liêm", 20.9892, 105.7958, "ONLINE", 2, new int[][]{{1, 12}, {2, 14}}, true),
            new LockerSeed("LOCKER_HN_03", "Tủ Giao Nhận Vinhomes Royal City (Ngã Tư Sở)", "Sảnh R1, KĐT Vinhomes Royal City, 72A Nguyễn Trãi, P. Thượng Đình, Q. Thanh Xuân", 21.0032, 105.8162, "ONLINE", 2, new int[][]{{1, 101}, {2, 102}}, true),
            new LockerSeed("LOCKER_HN_04", "Tủ Giao Nhận Bến Xe Yên Nghĩa (Metro Hà Đông)", "Sảnh Ga Yên Nghĩa (Tuyến Metro Cát Linh - Hà Đông), P. Yên Nghĩa, Q. Hà Đông", 20.9542, 105.7538, "ONLINE", 2, new int[][]{{1, 105}, {2, 106}}, true),
            new LockerSeed("LOCKER_HN_05", "Tủ Giao Nhận Trung Hòa - Nhân Chính (Cầu Giấy)", "Tòa Nhà 17T1 Hoàng Đạo Thúy, KĐT Trung Hòa Nhân Chính, Q. Cầu Giấy", 21.0088, 105.8035, "ONLINE", 2, new int[][]{{1, 109}, {2, 110}}, true),
            new LockerSeed("LOCKER_HN_06", "Tủ Giao Nhận GO! Thăng Long (Trần Duy Hưng)", "Đại Siêu Thị GO! Thăng Long, 222 Trần Duy Hưng, P. Trung Hòa, Q. Cầu Giấy", 21.0068, 105.7918, "ONLINE", 2, new int[][]{{1, 113}, {2, 114}}, true),
            new LockerSeed("LOCKER_HN_07", "Tủ Giao Nhận Aeon Mall Hà Đông (Dương Nội)", "Cổng 1, TTTM Aeon Mall Hà Đông, Khu Đô Thị Dương Nội, Q. Hà Đông", 20.9882, 105.7548, "ONLINE", 2, new int[][]{{1, 117}, {2, 118}}, true),
            new LockerSeed("LOCKER_HN_08", "Tủ Giao Nhận KĐT Mỗ Lao (Mulberry Lane)", "Khu Chung Cư TSQ Mulberry Lane, KĐT Mỗ Lao, Q. Hà Đông", 20.9858, 105.7822, "ONLINE", 2, new int[][]{{1, 121}, {2, 122}}, true),
            new LockerSeed("LOCKER_HN_09", "Tủ Giao Nhận ĐH Khoa Học Tự Nhiên (VNU)", "334 Nguyễn Trãi, P. Thanh Xuân Trung, Q. Thanh Xuân, Hà Nội", 20.9968, 105.8078, "ONLINE", 2, new int[][]{{1, 125}, {2, 126}}, true),
            new LockerSeed("LOCKER_HN_10", "Tủ Giao Nhận Trung Tâm Hành Chính Hà Đông", "Phố Tô Hiệu, P. Hà Cầu, Q. Hà Đông (Gần Ga Metro La Khê)", 20.9678, 105.7738, "ONLINE", 2, new int[][]{{1, 129}, {2, 130}}, true)
        );

        for (LockerSeed s : seeds) {
            Locker locker = lockerRepository.findById(s.id()).orElse(null);
            if (locker == null) {
                locker = Locker.builder()
                        .lockerId(s.id())
                        .name(s.name())
                        .address(s.address())
                        .latitude(s.lat())
                        .longitude(s.lng())
                        .connectionStatus(s.status())
                        .totalCompartments(2)
                        // GĐ12 — tủ ảo KHÔNG có nhịp tim: không bịa `LocalDateTime.now()` cho nó.
                        // Tủ thật (HN_01) tạo lần đầu thì lấy mốc hiện tại để không bị coi là "chưa
                        // từng gửi nhịp tim" ngay sau khi cài đặt.
                        .isVirtual(s.isVirtual())
                        .lastHeartbeat(s.isVirtual() ? null : LocalDateTime.now())
                        .build();
                lockerRepository.save(locker);
                log.info("  + Đã tự động tạo trạm tủ 2 ngăn: {} ({})", s.id(), s.name());
            } else {
                locker.setName(s.name());
                locker.setAddress(s.address());
                locker.setLatitude(s.lat());
                locker.setLongitude(s.lng());
                // GĐ10 — KHÔNG ghi đè trạng thái MAINTENANCE.
                //
                // Đây là lỗi thật đã bắt được khi kiểm: seeder chạy MỖI LẦN khởi động và ghi
                // `s.status()` (mặc định ONLINE) đè lên cột. Hệ quả: admin khoá tủ để bảo trì,
                // backend restart là tủ TỰ THOÁT bảo trì trong khi nhật ký vẫn ghi "đã khoá" —
                // lỗi im lặng, không ai phát hiện cho tới khi khách đặt được đơn vào tủ đang sửa.
                //
                // Bảo trì là quyết định của con người, seeder dữ liệu mẫu không được xoá nó.
                if (!"MAINTENANCE".equalsIgnoreCase(locker.getConnectionStatus())) {
                    locker.setConnectionStatus(s.status());
                }
                locker.setTotalCompartments(2);
                // GĐ12 — đồng bộ cờ phân loại. Cột này do seeder quản lý (khác `connectionStatus`
                // là quyết định của admin), nên ghi mỗi lần khởi động để dữ liệu cũ tự được gán
                // đúng: HN_01 = tủ thật, 9 tủ kia = tủ ảo.
                locker.setIsVirtual(s.isVirtual());
                lockerRepository.save(locker);
            }

            // Xóa bỏ mọi ngăn thừa có compIndex > 2 để đảm bảo hệ thống chuẩn 2 ngăn
            List<Compartment> existingComps = compartmentRepository.findByLocker_LockerId(s.id());
            for (Compartment c : existingComps) {
                if (c.getCompIndex() > 2) {
                    compartmentRepository.delete(c);
                }
            }

            // Đồng bộ đúng 2 ngăn tủ: Ngăn 1 (S - Nhỏ) và Ngăn 2 (L - Lớn)
            for (int[] compDef : s.comps()) {
                int compIndex = compDef[0];
                int pin = compDef[1];
                String size = (compIndex == 1) ? "S" : "L";

                var compOpt = compartmentRepository.findByLocker_LockerIdAndCompIndex(s.id(), compIndex);
                if (compOpt.isEmpty()) {
                    Compartment comp = Compartment.builder()
                            .locker(locker)
                            .compIndex(compIndex)
                            .size(size)
                            .status("EMPTY")
                            .isDoorClosed(true)
                            .currentWeight(0.0)
                            .relayPin(pin)
                            .build();
                    compartmentRepository.save(comp);
                } else {
                    Compartment comp = compOpt.get();
                    comp.setSize(size);
                    comp.setRelayPin(pin);
                    compartmentRepository.save(comp);
                }
            }

            // Đồng bộ lịch biểu 3 ngày cho 2 ngăn
            LocalDate today = LocalDate.now();
            for (int d = 0; d < 3; d++) {
                scheduleRepository.initScheduleIfNotExists(s.id(), today.plusDays(d), 2);
            }
        }

        // Tự động khởi tạo các đơn hàng PENDING mẫu trong DB cho Shipper nếu bật cấu hình app.seed.sample-orders
        if (seedSampleOrders && orderRepository.findByStatus("PENDING").isEmpty()) {
            Locker locker1 = lockerRepository.findById("LOCKER_HN_01").orElse(null);
            Locker locker2 = lockerRepository.findById("LOCKER_HN_02").orElse(null);
            Locker locker3 = lockerRepository.findById("LOCKER_HN_03").orElse(null);

            if (locker1 != null) {
                Compartment comp1 = compartmentRepository.findByLocker_LockerIdAndCompIndex("LOCKER_HN_01", 1).orElse(null);
                Compartment comp2 = compartmentRepository.findByLocker_LockerIdAndCompIndex("LOCKER_HN_01", 2).orElse(null);

                orderRepository.save(Order.builder()
                        .orderId("ORD-654123")
                        .customerName("Đoàn Viết Hoàng")
                        .customerPhone("0988123456")
                        .productName("Áo Hoodie PTIT Sinh Viên 2026")
                        .deliveryType("LOCKER")
                        .locker(locker1)
                        .compartment(comp1)
                        .expectedDate(LocalDate.now())
                        .status("PENDING")
                        .totalAmount(BigDecimal.valueOf(280000))
                        .paymentMethod("ONLINE_VIETQR")
                        .paymentStatus("PAID")
                        .createdAt(LocalDateTime.now())
                        .build());

                orderRepository.save(Order.builder()
                        .orderId("ORD-882104")
                        .customerName("Nguyễn Văn Tuấn")
                        .customerPhone("0912345678")
                        .productName("Chuột Công Thái Học Không Dây Logitech MX Master")
                        .deliveryType("LOCKER")
                        .locker(locker1)
                        .compartment(comp2)
                        .expectedDate(LocalDate.now())
                        .status("PENDING")
                        .totalAmount(BigDecimal.valueOf(650000))
                        .paymentMethod("ONLINE_VIETQR")
                        .paymentStatus("PAID")
                        .createdAt(LocalDateTime.now())
                        .build());
            }

            if (locker2 != null) {
                Compartment comp1 = compartmentRepository.findByLocker_LockerIdAndCompIndex("LOCKER_HN_02", 1).orElse(null);
                Compartment comp2 = compartmentRepository.findByLocker_LockerIdAndCompIndex("LOCKER_HN_02", 2).orElse(null);

                orderRepository.save(Order.builder()
                        .orderId("ORD-991345")
                        .customerName("Trần Thị Mai")
                        .customerPhone("0977888999")
                        .productName("Bàn Phím Cơ Không Dây RGB Low-Profile")
                        .deliveryType("LOCKER")
                        .locker(locker2)
                        .compartment(comp1)
                        .expectedDate(LocalDate.now())
                        .status("PENDING")
                        .totalAmount(BigDecimal.valueOf(850000))
                        .paymentMethod("ONLINE_VIETQR")
                        .paymentStatus("PAID")
                        .createdAt(LocalDateTime.now())
                        .build());

                orderRepository.save(Order.builder()
                        .orderId("ORD-332156")
                        .customerName("Lê Hoàng Nam")
                        .customerPhone("0934567890")
                        .productName("Áo Khoác Gió Thể Thao PTIT 2 Lớp Chống Nước")
                        .deliveryType("LOCKER")
                        .locker(locker2)
                        .compartment(comp2)
                        .expectedDate(LocalDate.now())
                        .status("PENDING")
                        .totalAmount(BigDecimal.valueOf(320000))
                        .paymentMethod("ONLINE_VIETQR")
                        .paymentStatus("PAID")
                        .createdAt(LocalDateTime.now())
                        .build());
            }

            if (locker3 != null) {
                Compartment comp1 = compartmentRepository.findByLocker_LockerIdAndCompIndex("LOCKER_HN_03", 1).orElse(null);
                orderRepository.save(Order.builder()
                        .orderId("ORD-554432")
                        .customerName("Phạm Thu Hương")
                        .customerPhone("0945678123")
                        .productName("Bình Giữ Nhiệt Thông Minh LED Báo Nhiệt Độ 500ml")
                        .deliveryType("LOCKER")
                        .locker(locker3)
                        .compartment(comp1)
                        .expectedDate(LocalDate.now())
                        .status("PENDING")
                        .totalAmount(BigDecimal.valueOf(195000))
                        .paymentMethod("ONLINE_VIETQR")
                        .paymentStatus("PAID")
                        .createdAt(LocalDateTime.now())
                        .build());
            }
            log.info("  + Đã tự động tạo các đơn hàng PENDING mẫu trong DB cho Shipper nạp!");
        }

        log.info(">>> Hoàn tất LockerDataSeeder: Đã bảo đảm 100% 10 trạm tủ chỉ có 2 ngăn (Ngăn 1: S, Ngăn 2: L)!");
    }
}
