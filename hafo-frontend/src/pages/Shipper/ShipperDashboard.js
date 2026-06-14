import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { io } from 'socket.io-client';
import { alertError, alertInfo, alertSuccess, confirmDialog } from '../../utils/hafoAlert';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;
const socket = io(SOCKET_URL, {
    transports: ['websocket'], // Ép dùng websocket để Render chạy mượt hơn
    withCredentials: true
});
const toVND = (n) => n?.toLocaleString('vi-VN');

const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Bán kính Trái Đất (km)
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c).toFixed(1); // Trả về số km (ví dụ: 1.2)
};

function ShipperDashboard() {
    //const [gpsError, setGpsError] = useState(null); // Thêm state lưu lỗi
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem('user')) || {};
    // Thêm một state để lưu số lượng đơn cũ
    //const [prevOrderCount, setPrevOrderCount] = useState(0);

    // --- CÁC STATE QUẢN LÝ ---
    const [orders, setOrders] = useState([]);
    const [filter, setFilter] = useState('all'); // 'all', 'recent', 'price'
    const [isWorking, setIsWorking] = useState(() => {
        return localStorage.getItem('isWorking') === 'true';
    });
    const [myLocation, setMyLocation] = useState(null); // Lưu tọa độ hiện tại
    const prevOrderCountRef = useRef(0);

    const [testerPos, setTesterPos] = useState({ x: 20, y: 80 }); // Vị trí (cách bottom, right)
    const [showTesterMenu, setShowTesterMenu] = useState(false); // Đóng/mở menu

    const [activeOrders, setActiveOrders] = useState([]); // ✅ Lưu danh sách đơn đang giao
    const activeOrdersRef = useRef([]); // Dùng Ref để GPS không bị restart liên tục
    const [profile, setProfile] = useState(null);
    useEffect(() => {
        const fetchShipperProfile = async () => {
            try {
                // Dùng API lấy hồ sơ shipper theo userId đã có trong localStorage
                const res = await api.get(`/shippers/profile/${user.id}`);
                setProfile(res.data);
            } catch (err) {
                console.error("Lỗi lấy hồ sơ shipper:", err);
            }
        };
        if (user.id) fetchShipperProfile();
    }, [user.id]);
    // Ngưỡng nợ tối đa (âm 500k)
    const DEBT_LIMIT = -500000;

    // Biến kiểm tra xem shipper có đang nợ quá nhiều không
    const isDebtTooHigh = profile?.income <= DEBT_LIMIT;

    useEffect(() => {
        activeOrdersRef.current = activeOrders;
    }, [activeOrders]);

    // --- 1. LOGIC LẤY ĐƠN HÀNG ---
    const fetchOrders = useCallback(async () => {
        if (!isWorking || !myLocation) return;

        try {
            const res = await api.get('/orders/available-orders', {
                params: {
                    lat: myLocation.lat,
                    lng: myLocation.lng,
                    radius: 5000
                }
            });

            const newOrders = res.data;

            // ✅ SỬ DỤNG BIẾN ĐỂ PHÁT ÂM THANH (Dùng prevOrderCount ở đây)
            if (newOrders.length > prevOrderCountRef.current) {
                const audio = new Audio('/sounds/notification.mp3');
                audio.play().catch(e => console.log("Trình duyệt chặn âm thanh"));
            }

            // ✅ CẬP NHẬT TRẠNG THÁI (Dùng setPrevOrderCount ở đây)
            prevOrderCountRef.current = newOrders.length;
            setOrders(newOrders);

        } catch (err) {
            console.error("Lỗi tìm đơn:", err);
        }
    }, [isWorking, myLocation]);

    // 2. Hàm sắp xếp dữ liệu: Tự động chạy khi 'orders' hoặc 'filter' thay đổi
    const sortedOrders = useMemo(() => {
        let data = [...orders];
        if (filter === 'recent') {
            data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else if (filter === 'price') {
            data.sort((a, b) => b.total - a.total);
        }
        return data;
    }, [orders, filter]);

    useEffect(() => {
        const fetchMyActiveOrders = async () => {
            try {
                // Giả sử API này trả về các đơn có shipperId = user.id và status !== 'done'
                const res = await api.get(`/orders?shipperId=${user.id}`);
                const ongoing = res.data.filter(o => o.status !== 'done' && o.status !== 'cancel');
                setActiveOrders(ongoing);
            } catch (err) { console.error(err); }
        };
        if (user.id) fetchMyActiveOrders();
    }, [user.id]);

    // --- 2. THEO DÕI VỊ TRÍ (Chỉ chạy khi đang làm việc) ---
    useEffect(() => {
        let watchId = null;
        if (isWorking && "geolocation" in navigator && user.id) {
            watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setMyLocation(coords);

                    // ✅ PHÁT TÍN HIỆU CHO TẤT CẢ ĐƠN ĐANG NHẬN
                    activeOrders.forEach(order => {
                        socket.emit('shipper_update_location', {
                            shipperId: user.id,
                            ...coords,
                            orderId: order._id // Gửi cho từng đơn cụ thể
                        });
                    });

                    api.put(`/shippers/location/${user.id}`, coords).catch(e => { });
                },
                (err) => console.error(err),
                { enableHighAccuracy: true, distanceFilter: 10 }
            );
        }
        return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
    }, [isWorking, activeOrders, user.id]);

    // Tự động cập nhật danh sách đơn mỗi 5 giây nếu đang bật trực
    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 5000);
        return () => clearInterval(interval);
    }, [fetchOrders]);

    // --- 3. XỬ LÝ NHẬN ĐƠN ---
    const handleAccept = async (orderId) => {
        // 1. Sử dụng confirmDialog để xác nhận (Bắt buộc có await)
        const isConfirmed = await confirmDialog(
            "Nhận đơn hàng?",
            "Bạn có chắc chắn muốn nhận thêm đơn này vào danh sách vận chuyển không?"
        );

        if (isConfirmed) {
            try {
                const res = await api.put(`/orders/${orderId}`, { shipperId: user.id });

                // 2. Thông báo thành công và ĐỢI 2 giây
                // Việc await ở đây giúp Shipper chắc chắn đã nhận được đơn trước khi danh sách cập nhật
                await alertSuccess(
                    "Thành công!",
                    "Đơn hàng đã được thêm vào danh sách đang giao của bạn."
                );

                // 3. Cập nhật state UI sau khi thông báo đóng
                setActiveOrders(prev => [...prev, res.data]);

            } catch (err) {
                // 4. Xử lý lỗi (ví dụ: đơn đã có người khác nhận mất)
                const errorMsg = err.response?.data?.message || "Không thể nhận đơn lúc này. Vui lòng thử lại!";
                alertError("Lỗi nhận đơn", errorMsg);
            }
        }
    };

    const MOCK_LOCATIONS = [
        { name: 'Quận 1 (TP.HCM)', lat: 10.762622, lng: 106.660172 },
        { name: 'Lý Thường Kiệt (Dĩ An)', lat: 10.907991, lng: 106.752177 },
        { name: 'Thanh Xuân (Hà Nội)', lat: 21.015991, lng: 105.821124 },
    ];

    return (
        <div style={{ padding: '15px' }}>
            {/* TRẠNG THÁI LÀM VIỆC */}
            <div style={{
                background: isWorking ? '#F0FDF4' : '#FFF1F2',
                padding: '20px', borderRadius: '16px', textAlign: 'center', marginBottom: '20px',
                border: `1px solid ${isWorking ? '#48c975ff' : '#FECDD3'}`
            }}>
                <h2 style={{ margin: '0 0 10px', fontSize: '18px', color: isWorking ? '#166534' : '#991B1B' }}>
                    {isWorking ? '🟢 Đang trực tuyến' : '🔴 Đang ngoại tuyến'}
                </h2>
                <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
                    {isWorking ? 'Hệ thống đang tìm kiếm đơn hàng xung quanh bạn...' : 'Bật trực để bắt đầu nhận đơn hàng từ các quán gần bạn.'}
                </p>
                <button
                    onClick={() => {
                        const nextState = !isWorking;
                        setIsWorking(nextState);
                        localStorage.setItem('isWorking', nextState); // Lưu trạng thái mới
                    }}
                    style={{
                        padding: '12px 30px', borderRadius: '30px', border: 'none',
                        background: isWorking ? '#EF4444' : '#22C55E', color: '#fff',
                        fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                >
                    {isWorking ? 'NGHỈ NGƠI (OFFLINE)' : 'BẮT ĐẦU LÀM VIỆC'}
                </button>
            </div>

            {activeOrders.length > 0 && (
                <div style={{ marginBottom: '25px', padding: '0 5px' }}>
                    <h3 style={{ fontSize: '15px', color: '#64748B', fontWeight: '800', marginBottom: '15px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        🛵 Đơn hàng đang giao ({activeOrders.length})
                    </h3>

                    {activeOrders.map(order => (
                        <div
                            key={order._id}
                            onClick={() => navigate(`/shipper/order/${order._id}`)}
                            style={{
                                background: '#fff',
                                padding: '16px',
                                borderRadius: '16px',
                                marginBottom: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '15px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                                border: '1px solid #F1F5F9',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 6px 15px rgba(0,0,0,0.08)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                            }}
                        >
                            {/* 1. Icon nổi bật bên trái thay cho số thứ tự */}
                            <div style={{
                                width: '45px', height: '45px', borderRadius: '12px',
                                background: '#FFF5F2', color: '#F97350',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '20px', flexShrink: 0
                            }}>
                                <i className="fa-solid fa-box-archive"></i>
                            </div>

                            {/* 2. Thông tin chính của đơn */}
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: '800', fontSize: '14px', color: '#334155' }}>
                                        #{order._id.slice(-6).toUpperCase()}
                                    </span>
                                    {/* Tag trạng thái nhỏ xinh thay cho nút bấm */}
                                    <span style={{
                                        fontSize: '10px',
                                        background: order.status === 'pickup' ? '#8B5CF6' : '#F97350',
                                        color: '#fff',
                                        padding: '2px 8px',
                                        borderRadius: '20px',
                                        fontWeight: 'bold'
                                    }}>
                                        {order.status === 'pickup' ? 'ĐANG GIAO' : 'ĐANG LẤY ĐƠN'}
                                    </span>
                                </div>

                                {/* Địa chỉ rút gọn */}
                                <div style={{ fontSize: '13px', color: '#64748B', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                                    <i className="fa-solid fa-location-dot" style={{ marginTop: '3px', color: '#94A3B8', fontSize: '11px' }}></i>
                                    <span style={{
                                        lineHeight: '1.4',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 1,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                    }}>
                                        {order.customer.split('|')[2]}
                                    </span>
                                </div>
                            </div>

                            {/* 3. Mũi tên chỉ hướng (Visual Cue) thay cho nút "Xem chi tiết" */}
                            <div style={{ color: '#CBD5E1', fontSize: '14px' }}>
                                <i className="fa-solid fa-chevron-right"></i>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {isWorking && (
                <>
                    {/* BỘ LỌC */}
                    <div className="ship-filter" style={{
                        display: 'flex',
                        gap: '10px',
                        marginBottom: '20px',
                        background: 'transparent', // ✅ Đảm bảo nền của dải menu luôn trong suốt
                        padding: '5px 0'
                    }}>
                        {['all', 'recent', 'price'].map((f) => (
                            <button
                                key={f}
                                className={filter === f ? 'active' : ''}
                                onClick={() => setFilter(f)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    border: filter === f ? 'none' : '1px solid #e2e8f0', // Viền mảnh khi không chọn
                                    background: filter === f ? '#F97350' : 'rgba(255, 255, 255, 0.5)', // ✅ Nền mờ nhẹ hoặc trong suốt
                                    color: filter === f ? '#fff' : '#64748b',
                                    fontWeight: '700',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    boxShadow: filter === f ? '0 4px 10px rgba(249, 115, 80, 0.2)' : 'none'
                                }}
                            >
                                {f === 'all' ? 'Tất cả' : f === 'recent' ? 'Gần đây' : 'Giá cao'}
                            </button>
                        ))}
                    </div>

                    {/* DANH SÁCH ĐƠN */}
                    <div style={{ paddingBottom: '20px' }}>
                        {orders.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '50px', color: '#999' }}>
                                <i className="fa-solid fa-box-open" style={{ fontSize: '40px', marginBottom: '10px' }}></i>
                                <p>Chưa có đơn hàng nào quanh đây.</p>
                            </div>
                        ) : (
                            sortedOrders.map(order => {
                                const restLng = order.restaurantId?.location?.coordinates[0];
                                const restLat = order.restaurantId?.location?.coordinates[1];

                                // Tính khoảng cách nếu có đủ tọa độ
                                const dist = (myLocation && restLat && restLng)
                                    ? getDistance(myLocation.lat, myLocation.lng, restLat, restLng)
                                    : null;

                                // Ước tính thời gian: 5 phút/km + 5 phút chuẩn bị (nếu không có dist thì hiện --)
                                const estTime = dist ? Math.ceil(dist * 5 + 5) : '--';
                                return (
                                    <div key={order._id} className="ship-card" style={{
                                        background: '#fff',
                                        padding: '16px',
                                        borderRadius: '16px',
                                        marginBottom: '15px',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                                        border: '1px solid #f1f5f9'
                                    }}>
                                        {/* Hàng 1: Tên quán và Thời gian */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
                                            <span style={{ fontSize: '12px', background: '#FFF7ED', color: '#C2410C', padding: '4px 10px', borderRadius: '20px', fontWeight: '700' }}>
                                                <i className="fa-solid fa-store"></i> {order.restaurantId?.name}
                                            </span>
                                            {/* HIỂN THỊ KHOẢNG CÁCH & THỜI GIAN */}
                                            <span style={{ fontSize: '12px', color: '#F97350', fontWeight: '800' }}>
                                                <i className="fa-solid fa-route"></i> {dist}km ({estTime} phút)
                                            </span>
                                            <span style={{ fontSize: '12px', color: '#999' }}>
                                                <i className="fa-regular fa-clock"></i> {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>

                                        {/* Hàng 2: Tên món ăn */}
                                        <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#333' }}>
                                            {Array.isArray(order.items) ? order.items[0].name + (order.items.length > 1 ? ` +${order.items.length - 1}` : '') : 'Đơn hàng'}
                                        </h3>

                                        {/* Hàng 3: Địa chỉ khách hàng */}
                                        <div style={{ display: 'flex', gap: '8px', color: '#64748b', fontSize: '13px', marginBottom: '15px', alignItems: 'flex-start' }}>
                                            <i className="fa-solid fa-location-dot" style={{ color: '#22C55E', marginTop: '3px' }}></i>
                                            <span style={{ lineHeight: '1.4' }}>{order.customer.split('|')[2] || 'Địa chỉ khách'}</span>
                                        </div>
                                        {order.tipAmount > 0 && (
                                            <div style={{
                                                marginTop: '12px', padding: '10px', borderRadius: '12px',
                                                background: '#F0FDF4', border: '1px solid #BBF7D0',
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                            }}>
                                                <div style={{ fontSize: '13px', color: '#166534', fontWeight: '700' }}>
                                                    <i className="fa-solid fa-gift"></i> Tiền thưởng:
                                                </div>
                                                <b style={{ color: '#22C55E', fontSize: '15px' }}>
                                                    +{toVND(order.tipAmount * 0.8)}đ
                                                </b>
                                            </div>
                                        )}

                                        {/* Hàng 4: Chân thẻ (Tiền + Nút bấm) - SỬA LẠI CHỖ NÀY ĐỂ KHÔNG BỊ ĐÈ */}
                                        <div style={{
                                            borderTop: '1px dashed #eee',
                                            paddingTop: '12px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '11px', color: '#999' }}>Tổng thu hộ</div>
                                                <div style={{ fontWeight: '800', color: '#F97350', fontSize: '18px' }}>
                                                    {toVND(order.total)}
                                                </div>
                                            </div>

                                            <button
                                                disabled={isDebtTooHigh}
                                                onClick={() => handleAccept(order._id)}
                                                style={{
                                                    background: 'linear-gradient(135deg, #F97350 0%, #FF9F43 100%)',
                                                    color: '#fff',
                                                    border: 'none',
                                                    padding: '10px 20px',
                                                    borderRadius: '12px',
                                                    fontSize: '14px',
                                                    fontWeight: '800',
                                                    cursor: 'pointer',
                                                    boxShadow: '0 4px 12px rgba(249, 115, 80, 0.2)',
                                                    transition: 'all 0.2s',
                                                    whiteSpace: 'nowrap' // Đảm bảo chữ không bị xuống dòng
                                                }}
                                                onMouseOver={(e) => e.target.style.transform = 'scale(1.05)'}
                                                onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                                            >
                                                {isDebtTooHigh ? 'VÍ NỢ CAO' : 'NHẬN ĐƠN'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}
            {/* MENU GIẢ LẬP VỊ TRÍ - CHỈ HIỆN KHI ĐANG DEV */}

            <div style={{
                position: 'fixed',
                bottom: `${testerPos.y}px`,
                right: `${testerPos.x}px`,
                zIndex: 10000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '10px'
            }}>
                {/* 1. Menu xổ xuống (Chỉ hiện khi nhấn vào Avatar) */}
                {showTesterMenu && (
                    <div className="animate-pop-in" style={{
                        background: '#fff',
                        padding: '15px',
                        borderRadius: '16px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                        border: '2px solid #F97350',
                        width: '180px',
                        marginBottom: '5px'
                    }}>
                        <div style={{ fontSize: '11px', fontWeight: '800', marginBottom: '10px', color: '#F97350', textAlign: 'center' }}>
                            <i className="fa-solid fa-flask"></i> CHỌN ĐIỂM ĐẾN
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {MOCK_LOCATIONS.map(loc => (
                                <button
                                    key={loc.name}
                                    onClick={() => {
                                        const coords = { lat: loc.lat, lng: loc.lng };
                                        setMyLocation(coords);
                                        api.put(`/shippers/location/${user.id}`, coords).catch(() => { });
                                        alertInfo(`Đã di chuyển đến: ${loc.name}`);
                                        setShowTesterMenu(false);
                                    }}
                                    style={{
                                        padding: '10px', fontSize: '11px', borderRadius: '10px',
                                        border: '1px solid #eee', cursor: 'pointer',
                                        background: myLocation?.lat === loc.lat ? '#FFF5F2' : '#f9fafb',
                                        fontWeight: myLocation?.lat === loc.lat ? 'bold' : 'normal',
                                        color: myLocation?.lat === loc.lat ? '#F97350' : '#333'
                                    }}
                                >
                                    {loc.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 2. Nút Avatar (Bong bóng di chuyển) */}
                <div
                    onMouseDown={(e) => {
                        // Logic di chuyển (Draggable)
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const initialX = testerPos.x;
                        const initialY = testerPos.y;

                        const onMouseMove = (moveEvent) => {
                            setTesterPos({
                                x: initialX + (startX - moveEvent.clientX),
                                y: initialY + (startY - moveEvent.clientY)
                            });
                        };

                        const onMouseUp = () => {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);
                        };

                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                    }}
                    onClick={(e) => {
                        // Chỉ mở menu nếu không phải là đang kéo (Drag)
                        setShowTesterMenu(!showTesterMenu);
                    }}
                    style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '50%',
                        background: '#F97350',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        cursor: 'grab',
                        boxShadow: '0 4px 15px rgba(249, 115, 80, 0.4)',
                        border: '3px solid #fff',
                        fontSize: '20px',
                        userSelect: 'none',
                        transition: 'transform 0.2s active:scale-95'
                    }}
                    title="Kéo để di chuyển, Nhấn để đổi vị trí"
                >
                    <i className={showTesterMenu ? "fa-solid fa-xmark" : "fa-solid fa-flask"}></i>
                    {/* Chấm đỏ nhỏ báo hiệu chế độ Tester */}
                    <span style={{ position: 'absolute', top: 0, right: 0, width: '12px', height: '12px', background: '#22C55E', borderRadius: '50%', border: '2px solid #fff' }}></span>
                </div>
            </div>
        </div>
    );
}

export default ShipperDashboard;
