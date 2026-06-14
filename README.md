# HaFo - Nền tảng giao đồ ăn trực tuyến

Nền tảng giao đồ ăn trực tuyến và quản lý cửa hàng toàn diện, tích hợp tính năng tự động điều phối đơn hàng theo vị trí địa lý, thanh toán điện tử MoMo và trợ lý ảo hỗ trợ khách hàng bằng trí tuệ nhân tạo (AI).

## Tổng quan

Hệ thống được thiết kế nhằm tối ưu hóa quy trình vận hành và kết nối các đối tượng trong chuỗi cung ứng giao nhận thực phẩm, bao gồm: Khách hàng (Customer), Đối tác nhà hàng (Merchant), Đối tác tài xế (Shipper) và Quản trị viên hệ thống (Admin). Nền tảng giải quyết các bài toán thực tế sau:

- **Phân quyền và phối hợp vận hành**: Cung cấp các giao diện quản lý chuyên biệt phù hợp với vai trò của từng nhóm người dùng.
- **Tối ưu hóa điều phối đơn hàng**: Sử dụng hệ thống tính toán khoảng cách thực tế để hiển thị các đơn hàng đang chờ giao cho tài xế ở khu vực lân cận, rút ngắn thời gian giao nhận.
- **Hệ thống đối soát tài chính tự động**: Ghi nhận doanh thu của cửa hàng, tính toán tiền công cho tài xế và xử lý bù trừ dòng tiền đối với các đơn hàng thanh toán bằng tiền mặt (áp dụng cơ chế ví âm).
- **Kiểm duyệt nội dung tự động**: Sử dụng AI để kiểm tra hành vi ngôn từ của khách hàng khi tương tác với chatbot, áp dụng cảnh cáo hoặc khóa tài khoản tự động đối với các tài khoản vi phạm tiêu chuẩn cộng đồng.

## Kiến trúc hệ thống và Thiết kế cơ sở dữ liệu

Ứng dụng được xây dựng theo mô hình Client-Server độc lập. Frontend React quản lý trạng thái giao diện người dùng, trong khi Backend Express xử lý các nghiệp vụ logic, truyền thông thời gian thực, quản lý cơ sở dữ liệu và tích hợp các API bên thứ ba.

### Thiết kế lược đồ dữ liệu và Chuẩn hóa (Database Schema Design & Normalization)

Cơ sở dữ liệu sử dụng MongoDB thông qua thư viện Mongoose. Cấu trúc dữ liệu giải quyết các thách thức kỹ thuật sau:

- **Bảo toàn toàn vẹn dữ liệu và Chuẩn hóa**: Lược đồ người dùng (User schema) tách biệt thông tin tài khoản cơ bản với hồ sơ hoạt động thực tế. Dữ liệu cửa hàng (Restaurant) và tài xế (Shipper) được lưu trữ tại các bộ sưu tập riêng biệt và liên kết với User schema bằng cơ chế tham chiếu (ObjectId). Cách tiếp cận này giúp giảm kích thước tài liệu User và tối ưu hóa hiệu năng truy vấn.
- **Truy vấn vị trí địa lý (Geospatial Querying)**: Cả hai bộ sưu tập Restaurant và Shipper đều được thiết lập chỉ mục địa lý 2dsphere trên trường tọa độ (location). Điều này cho phép hệ thống thực thi các câu lệnh truy vấn $near để xác định khoảng cách và tìm kiếm tài xế hoặc nhà hàng trong phạm vi bán kính quy định một cách nhanh chóng.
- **Theo dõi lịch trình đơn hàng**: Lược đồ Order lưu trữ quy trình trạng thái đơn hàng (new, prep, ready, pickup, done, cancel) cùng với đối tượng lồng nhau lưu vết mốc thời gian chi tiết (timeline). Dữ liệu này phục vụ cho việc phân tích hiệu suất giao hàng và đối soát lỗi khi có tranh chấp.

### Cơ chế giao tiếp thời gian thực (Real-Time Event Driven Architecture)

Hệ thống tích hợp Socket.io để thiết lập kênh kết nối hai chiều liên tục giữa máy chủ và các máy trạm:

- **Điều phối đơn hàng đến nhà hàng**: Khi đăng nhập, các tài khoản nhà hàng sẽ tham gia vào các phòng socket (socket room) riêng biệt dựa trên mã định danh của cửa hàng (shopId). Khi có đơn hàng mới được tạo, máy chủ sẽ phát tín hiệu trực tiếp đến phòng của cửa hàng để kích thích thông báo đẩy và cập nhật giao diện mà không cần tải lại trang.
- **Theo dõi vị trí tài xế**: Tài xế liên tục gửi tọa độ GPS hiện tại lên máy chủ trong quá trình giao hàng. Máy chủ sẽ chuyển tiếp dữ liệu này đến phòng theo dõi đơn hàng (tracking_order_<OrderId>) để cập nhật vị trí trực tiếp của tài xế lên bản đồ của khách hàng.
- **Kiểm soát tải của tài xế**: Để tránh hiện tượng tài xế ôm đơn gây trễ hạn giao hàng, hệ thống giới hạn số lượng đơn hàng hoạt động cùng lúc của tài xế (tối đa 3 đơn chưa hoàn thành). Các tài xế đạt giới hạn sẽ không hiển thị trong danh sách đơn hàng lân cận cho đến khi hoàn thành các đơn hiện tại.

### Giao dịch tài chính và Cơ chế ví tiền điện tử

Quy trình thanh toán và cập nhật số dư ví được kích hoạt tự động ngay khi đơn hàng chuyển sang trạng thái hoàn thành (done):

- **Phân phối doanh thu cửa hàng**: Hệ thống tính toán giá trị thực của các món ăn (sau khi trừ đi các mã giảm giá của nhà hàng) và cộng trực tiếp vào số dư doanh thu của Restaurant.
- **Thu nhập tài xế và Đối soát tiền mặt (Ví âm)**: Tài xế nhận được phí giao hàng cố định cộng với 80 phần trăm số tiền boa của khách hàng. Với các đơn hàng thanh toán qua MoMo, số tiền này được cộng trực tiếp vào ví. Đối với đơn hàng COD (Tiền mặt), hệ thống thực hiện bù trừ (thu nhập của tài xế trừ đi tổng tiền đơn hàng phải thu hộ), tạo ra cơ chế ví âm để ghi nhận số tiền tài xế đang giữ của hệ thống.
- **Cập nhật hạn mức khuyến mãi**: Hệ thống tự động giảm số lượng sử dụng của mã giảm giá khi đơn hàng hoàn thành. Nếu số lượng mã về không, mã đó sẽ chuyển sang trạng thái ngừng hoạt động. Mã giảm giá hệ thống tặng riêng cho người dùng cũng được đánh dấu đã sử dụng để tránh dùng lại.
- **Xếp hạng thành viên (Loyalty Tiers)**: Tổng chi tiêu của khách hàng được tích lũy theo từng đơn hàng thành công để tự động nâng hạng thành viên (Silver, Gold, Diamond) và tự động cấp các gói mã giảm giá hệ thống tương ứng với từng thứ hạng.

### Quy trình kiểm duyệt nội dung bằng AI

Để bảo vệ môi trường giao tiếp lành mạnh, hệ thống chatbot được bảo vệ bởi một lớp kiểm duyệt trung gian:

- **Bộ lọc từ ngữ độc hại**: Tin nhắn của khách hàng được gửi qua middleware kiểm duyệt trước khi đưa vào chatbot. Middleware này sử dụng mô hình Gemini Flash để phân tích ngữ cảnh. Nếu phát hiện ngôn từ tục tĩu hoặc thù ghét, hệ thống sẽ chặn cuộc hội thoại và gửi thông báo nhắc nhở khách hàng.
- **Khóa tài khoản tự động**: Số lần vi phạm ngôn từ của người dùng được lưu trữ trên cơ sở dữ liệu. Nếu vi phạm đủ 3 lần, tài khoản sẽ tự động chuyển sang trạng thái bị khóa (locked) trong vòng 7 ngày, đồng thời gửi email thông báo lý do chi tiết cho người dùng qua hệ thống Nodemailer.

## Các tính năng chính

### Tính năng dành cho Khách hàng
- **Tìm kiếm nhà hàng**: Tìm kiếm nhà hàng theo danh mục ẩm thực, khoảng cách địa lý và trạng thái hoạt động.
- **Giỏ hàng tùy chỉnh**: Chọn món ăn kèm cấu hình kích cỡ, các loại topping và ghi chú riêng cho từng món.
- **Sổ địa chỉ tiện lợi**: Lưu trữ nhiều địa chỉ giao hàng kèm theo nhãn tên và tọa độ GPS tương ứng.
- **Quản lý mã giảm giá**: Áp dụng mã giảm giá của riêng nhà hàng hoặc voucher của hệ thống tại bước thanh toán.
- **Theo dõi đơn hàng thời gian thực**: Theo dõi toàn bộ quá trình chuẩn bị, nhận hàng của tài xế và xem vị trí tài xế di chuyển trên bản đồ.
- **Đánh giá hai chiều độc lập**: Gửi phản hồi và chấm điểm xếp hạng riêng biệt cho chất lượng món ăn (nhà hàng) và chất lượng giao hàng (tài xế).
- **Hỗ trợ khách hàng bằng AI**: Trò chuyện trực tiếp với trợ lý ảo HaFo AI để nhận gợi ý món ăn phù hợp với sở thích tiêu dùng hoặc truy vấn nhanh tình trạng đơn hàng mới nhất.

### Tính năng dành cho Đối tác Nhà hàng
- **Trực quan hóa số liệu**: Theo dõi doanh thu, số lượng đơn hàng và thống kê chi tiết các món ăn bán chạy thông qua biểu đồ phân tích.
- **Quản lý thực đơn**: Thêm mới, chỉnh sửa thông tin món ăn, cấu hình các tùy chọn kích thước và danh sách topping đi kèm.
- **Quản lý thông tin cửa hàng**: Cập nhật giờ đóng/mở cửa, số điện thoại, địa chỉ, định vị tọa độ của quán và bật/tắt trạng thái hoạt động nhanh.
- **Quản lý đơn hàng**: Nhận đơn hàng mới, xác nhận chuẩn bị món, báo hoàn thành để shipper đến lấy hàng.
- **Tạo mã khuyến mãi**: Tự tạo các chương trình giảm giá riêng cho cửa hàng với giới hạn số lần sử dụng và thời hạn áp dụng.
- **Quản lý ví doanh thu**: Đối soát lịch sử dòng tiền của quán và gửi yêu cầu rút tiền về tài khoản ngân hàng liên kết.
- **Phản hồi đánh giá**: Theo dõi các ý kiến đóng góp của khách hàng và gửi phản hồi phản hồi trực tiếp.

### Tính năng dành cho Đối tác Tài xế
- **Nhận đơn lân cận**: Hiển thị danh sách các đơn hàng đang chờ giao của các nhà hàng nằm trong bán kính 10km so với vị trí hiện tại của tài xế.
- **Chỉ đường và giao nhận**: Xem thông tin định vị của nhà hàng và địa chỉ giao hàng của khách hàng để di chuyển chính xác.
- **Cập nhật trạng thái**: Thực hiện các thao tác xác nhận đã lấy hàng tại quán và xác nhận đã giao hàng thành công cho khách.
- **Quản lý ví tài xế**: Theo dõi thu nhập tích lũy, tiền boa, số tiền mặt thu hộ cần đối soát và gửi yêu cầu rút tiền về tài khoản.
- **Thông tin cá nhân**: Cài đặt loại phương tiện, biển số xe, tài khoản ngân hàng nhận tiền và cập nhật trạng thái sẵn sàng nhận đơn.

### Tính năng dành cho Quản trị viên (Admin)
- **Phê duyệt đối tác**: Xem xét hồ sơ đăng ký kinh doanh và thông tin cá nhân của các yêu cầu làm nhà hàng hoặc tài xế mới.
- **Quản lý và khóa tài khoản**: Quản lý danh sách người dùng toàn hệ thống, theo dõi số lần vi phạm ngôn từ và thực hiện khóa hoặc mở khóa tài khoản kèm lý do cụ thể.
- **Duyệt yêu cầu rút tiền**: Đối soát giao dịch rút tiền của tài xế và nhà hàng để duyệt chuyển khoản ngân hàng.
- **Giám sát hoạt động**: Theo dõi danh sách đơn hàng toàn hệ thống, tiếp nhận và xử lý các báo cáo vi phạm hoặc khiếu nại từ khách hàng.

## Công nghệ sử dụng

### Frontend
- **Thư viện chính**: React.js
- **Xác thực người dùng**: Firebase Authentication
- **Kết nối API**: Axios
- **Giao tiếp thời gian thực**: Socket.io-client
- **Giao diện**: Modular Vanilla CSS

### Backend
- **Môi trường chạy**: Node.js
- **Framework**: Express.js
- **Kết nối thời gian thực**: Socket.io
- **Hệ thống gửi thư**: Nodemailer
- **Xử lý hình ảnh**: Multer kết hợp dịch vụ Cloudinary

### Cơ sở dữ liệu
- **Hệ quản trị cơ sở dữ liệu**: MongoDB
- **Thư viện tương tác**: Mongoose

### Dịch vụ tích hợp bên thứ ba
- **Cổng thanh toán điện tử**: MoMo Sandbox API (Sử dụng chữ ký bảo mật HMAC-SHA256)
- **Trí tuệ nhân tạo**: Google Generative AI (Gemini Flash API)

## Hướng dẫn cài đặt và khởi chạy

### Yêu cầu hệ thống
- Node.js (Phiên bản 16 trở lên)
- Máy chủ MongoDB hoạt động
- Tài khoản lưu trữ Cloudinary
- Mã khóa kết nối Gemini API

### Cài đặt và cấu hình

1. Tải mã nguồn về máy:
   ```bash
   git clone https://github.com/username/projectname.git
   cd projectname
   ```

2. Cấu hình biến môi trường cho Backend. Tạo tệp `.env` trong thư mục `hafo-backend`:
   ```env
   PORT=5000
   MONGO_URI=duong_dan_ket_noi_mongodb
   GEMINI_API_KEY=ma_api_key_gemini
   CLOUDINARY_CLOUD_NAME=ten_tai_khoan_cloudinary
   CLOUDINARY_API_KEY=khoa_api_key_cloudinary
   CLOUDINARY_API_SECRET=khoa_bi_mat_cloudinary
   EMAIL_USER=dia_chi_email_he_thong
   EMAIL_PASS=mat_khau_ung_dung_email
   FRONTEND_URL=http://localhost:3000
   BACKEND_URL=http://localhost:5000
   ```

3. Cài đặt các thư viện phụ thuộc và khởi động máy chủ Backend:
   ```bash
   cd hafo-backend
   npm install
   npm start
   ```

4. Cấu hình biến môi trường cho Frontend. Tạo tệp `.env` trong thư mục `hafo-frontend`:
   ```env
   REACT_APP_API_URL=http://localhost:5000
   REACT_APP_FIREBASE_API_KEY=khoa_api_key_firebase
   REACT_APP_FIREBASE_AUTH_DOMAIN=ten_mien_xac_thuc_firebase
   REACT_APP_FIREBASE_PROJECT_ID=ma_du_an_firebase
   REACT_APP_FIREBASE_STORAGE_BUCKET=bo_nho_luu_tru_firebase
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=ma_gui_tin_nhan_firebase
   REACT_APP_FIREBASE_APP_ID=ma_ung_dung_firebase
   ```

5. Cài đặt các thư viện phụ thuộc và khởi chạy ứng dụng Frontend:
   ```bash
   cd ../hafo-frontend
   npm install
   npm start
   ```
