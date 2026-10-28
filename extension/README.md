# DinoPost AI - Chrome Extension (Reddit Auto Publisher)

> **Đồ án môn học: Chuyên đề Trí tuệ Nhân tạo**  
> Kiến trúc: **Chrome Extension (Manifest V3) + AI Agent (MiniMax M3.1 Flash) + DOM Automation**  
> Phong cách thiết kế: **Browsentic-style harness** (Chạy trực tiếp trên phiên trình duyệt có sẵn)

---

## 1. Điểm nổi bật so với kiến trúc cũ
* **Chế độ Bảng bên (Side Panel)**: Tiện ích mở cố định ở cạnh phải màn hình Chrome, **không bao giờ bị tắt khi bấm chuột ra ngoài** hay chuyển tab.
* **Tự động lưu bản nháp (Draft Persistence)**: Toàn bộ nội dung tiêu đề, thân bài và các file ảnh/video tải lên đều được tự động lưu theo thời gian thực. Mở lại trình duyệt bất kỳ lúc nào bài viết vẫn còn nguyên vẹn.
* **Không cần mở Chrome phụ**: Tận dụng 100% phiên đăng nhập tài khoản Reddit có sẵn trên trình duyệt bạn đang dùng hàng ngày.
* **Không sợ chặn mạng**: Kế thừa trực tiếp cấu hình mạng, DNS và Cloudflare WARP (1.1.1.1) của máy.
* **Hỗ trợ Ảnh & Video đa năng**:
  * **Tải từ máy tính**: Kéo thả hoặc chọn trực tiếp file ảnh (`PNG`, `JPG`, `GIF`, `WebP`) hoặc video (`MP4`, `WebM`).
  * **Tạo ảnh bằng AI**: Tích hợp mô hình AI tạo ảnh nghệ thuật (Pollinations.ai FLUX), tự động phân tích chủ đề bài viết và vẽ hình minh họa sắc nét mà không cần API key.
  * Xem trước ảnh/video thu nhỏ trực quan kèm kích thước và nút xóa tiện lợi.
* **Tự động hóa DOM native**: Can thiệp trực tiếp vào Lexical Rich Text Editor của Reddit bằng native DOM event & DataTransfer, tự động đính kèm tệp media và điền nội dung.
* **Không cần cài Visual Studio C++**: Tiện ích mở rộng chạy trực tiếp trên Chrome, cực kỳ gọn nhẹ và dễ demo.

---

## 2. Hướng dẫn cài đặt vào Google Chrome (Chỉ mất 20 giây)

1. Mở trình duyệt Google Chrome thông thường của bạn.
2. Trên thanh địa chỉ, nhập:
   ```text
   chrome://extensions/
   ```
   rồi nhấn **Enter**.
3. Ở góc trên cùng bên phải, gạt công tắc **Chế độ dành cho nhà phát triển (Developer mode)** sang **BẬT (ON)**.
4. Ở góc trên cùng bên trái, bấm nút: **Tải tiện ích đã giải nén (Load unpacked)**.
5. Chọn thư mục:
   ```text
   D:\Chuyên đề\RedditPost-AI-Extension
   ```
6. Tiện ích **DinoPost AI - Trợ lý Đăng bài Reddit** sẽ xuất hiện ngay trên danh sách tiện ích của Chrome!

---

## 3. Cách sử dụng

1. Trên Chrome, mở tab **Reddit** bạn đang đăng nhập sẵn (ví dụ vào `https://www.reddit.com/r/test/submit` hoặc trang cá nhân của bạn).
2. Nhấp vào biểu tượng mảnh ghép (Extensions) ở góc trên bên phải Chrome → ghim (pin) **DinoPost AI** ra ngoài thanh công cụ.
3. Bấm vào biểu tượng khủng long 🦖 của tiện ích:
   * **Chat với AI**: Gõ yêu cầu viết bài vào ô *"Chat với Dino AI"* (ví dụ: *"Viết bài chia sẻ cảm nghĩ khi hoàn thành đồ án môn AI"*) → Bấm **Tạo bài với AI**. Mô hình **MiniMax M3.1 Flash** sẽ tự động sinh Tiêu đề và Nội dung bài viết.
   * **Đính kèm Ảnh & Video**:
     * Bấm **📁 Tải từ máy** hoặc kéo thả file ảnh/video vào khung.
     * Bấm **🎨 Dino AI Vẽ ảnh** để AI tự động vẽ tranh minh họa cho bài viết.
   * **Nơi đăng (Destination)**: Điền `r/test` hoặc trang cá nhân của bạn `u/<username>`.
   * **Đăng tự động**: Tích chọn *"Tự động bấm nút Đăng"* rồi nhấn nút:
     👉 **🚀 Điền vào Reddit & Đăng bài**.
4. Tiện ích sẽ tự động điền Tiêu đề, Nội dung, đính kèm file media vào form Reddit và tự động bấm nút **Đăng** để xuất bản bài viết ngay trước mắt bạn!
