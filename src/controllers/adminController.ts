import { Request, Response } from 'express';
import Card from '../models/Card';
import Transaction from '../models/Transaction';
import User from '../models/User';
import ParkingSession from '../models/ParkingSession';
import mongoose from 'mongoose';

// Cấu hình giá đỗ xe
const PARKING_FEE_PER_HOUR = 5000;

// ADMIN: POST /users
export const createUser = async (req: Request, res: Response) => {
    try {
        const { user_id, name, email, password, role } = req.body;

        if (!user_id || !name || !email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Tất cả các trường đều bắt buộc'
            });
        }

        if (role && !['user', 'admin'].includes(role)) {
            return res.status(400).json({
                status: 'error',
                message: 'Role phải là "user" hoặc "admin"'
            });
        }

        const newUser = new User({
            user_id,
            name,
            email,
            password,
            role,
        });

        await newUser.save();

        res.status(201).json({
            status: 'success',
            message: 'Tạo người dùng thành công.',
            data: {
                user_id: newUser.user_id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                created_at: newUser.createdAt,
            },
        });
    } catch (error) {
        if ((error as any).code === 11000) {
            return res.status(409).json({ status: 'error', message: 'User ID hoặc Email đã tồn tại.' });
        }
        res.status(400).json({ status: 'error', message: (error as Error).message });
    }
};

export const getCardDetails = async (req: Request, res: Response) => {
    try {
        const card = await Card.findOne({ card_id: req.params.card_id }).populate('user', 'user_id name email');
        if (!card) {
            return res.status(404).json({ status: 'error', message: 'Card not found' });
        }
        res.status(200).json({
            status: 'success',
            data: {
                card_id: card.card_id,
                user: card.user,
                license_plate: card.license_plate,
                owner_name: card.owner_name,
                balance: card.balance,
                is_active: card.is_active,
                created_at: card.createdAt,
            },
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: (error as Error).message });
    }
};

// ADMIN: POST /cards/create
export const registerCard = async (req: Request, res: Response) => {
    try {
        const { card_id, user_id, license_plate, owner_name, initial_balance = 0 } = req.body;

        const user = await User.findOne({ user_id: user_id });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const newCard = new Card({
            card_id,
            user: user._id,
            license_plate,
            owner_name,
            balance: initial_balance,
        });
        await newCard.save();

        res.status(201).json({
            status: 'success',
            message: 'Tạo thẻ thành công.',
            data: {
                card_id: newCard.card_id,
                user_id: user.user_id,
                owner_name: newCard.owner_name,
                balance: newCard.balance,
                is_active: newCard.is_active,
                created_at: newCard.createdAt,
            },
        });
    } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
            return res.status(400).json({ status: 'error', message: `Invalid format for field ${error.path}` });
        }
        res.status(400).json({ status: 'error', message: (error as Error).message });
    }
};

// ADMIN: DELETE /cards/delete/{card_id}
export const deleteCard = async (req: Request, res: Response) => {
    try {
        const { card_id } = req.params;
        const card = await Card.findOne({ card_id });
        if (!card) {
            return res.status(404).json({ status: 'error', message: 'Card not found' });
        }

        if (!card) {
            return res.status(404).json({ status: 'error', message: 'Card not found' });
        }

        res.status(200).json({
            status: 'success',
            message: `Đã vô hiệu hóa thẻ ${card.card_id} thành công.`,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: (error as Error).message });
    }
};

// POST /cards/{card_id}/reactivate
export const reactivateCard = async (req: Request, res: Response) => {
    try {
        const { card_id } = req.params;
        const card = await Card.findOne({ card_id });
        if (!card) {
            return res.status(404).json({ status: 'error', message: 'Card not found' });
        }

        if (card.is_active) {
            return res.status(400).json({ status: 'error', message: 'Card is already active' });
        }

        card.is_active = true;
        await card.save();

        res.status(200).json({
            status: 'success',
            message: `Đã kích hoạt lại thẻ ${card.card_id} thành công.`,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: (error as Error).message });
    }
}

// ADMIN: POST /cards/{card_id}/recharge
export const adminRechargeCard = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { amount, payment_method } = req.body;
        if (!amount || amount <= 0) {
            await session.abortTransaction();
            return res.status(400).json({ status: 'error', message: 'Invalid amount' });
        }

        const card = await Card.findOne({ card_id: req.params.card_id, is_active: true }).session(session);
        if (!card) {
            await session.abortTransaction();
            return res.status(400).json({ status: 'error', message: 'Invalid amount' });
        }

        card.balance += amount;
        await card.save({ session });

        const transaction = new Transaction({
            card: card._id,
            type: 'RECHARGE',
            amount: amount,
            payment_method: payment_method || 'ONLINE',
            description: `Nạp tiền qua ${payment_method || 'ONLINE'}`,
        });
        await transaction.save({ session });

        await session.commitTransaction();
        res.status(200).json({
            status: 'success',
            message: 'Nạp tiền thành công.',
            card_id: card.card_id,
            new_balance: card.balance,
            transaction_id: transaction.transaction_id
        });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: 'error', message: (error as Error).message });
    } finally {
        session.endSession();
    }
};

// ADMIN: POST /cards/{card_id}/parking/checkin
export const parkingCheckIn = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { location } = req.body;
        const { card_id } = req.params;

        if (!location) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: 'Location là bắt buộc'
            });
        }

        const card = await Card.findOne({ card_id, is_active: true }).session(session);
        if (!card) {
            await session.abortTransaction();
            return res.status(404).json({
                status: 'error',
                message: 'Card not found or is inactive'
            });
        }

        // Kiểm tra xem có session đang active không
        const activeSession = await ParkingSession.findOne({
            card: card._id,
            status: 'ACTIVE'
        }).session(session);

        if (activeSession) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: 'Thẻ này đang có phiên đỗ xe chưa kết thúc',
                data: {
                    location: activeSession.location,
                    timestamp_in: activeSession.timestamp_in
                }
            });
        }

        // Tạo parking session mới
        const parkingSession = new ParkingSession({
            card: card._id,
            location,
            timestamp_in: new Date(),
            status: 'ACTIVE'
        });
        await parkingSession.save({ session });

        await session.commitTransaction();
        res.status(200).json({
            status: 'success',
            message: 'Check-in thành công',
            data: {
                session_id: parkingSession._id,
                card_id: card.card_id,
                license_plate: card.license_plate,
                location: parkingSession.location,
                timestamp_in: parkingSession.timestamp_in,
                current_balance: card.balance
            }
        });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: 'error', message: (error as Error).message });
    } finally {
        session.endSession();
    }
};

// ADMIN: POST /cards/{card_id}/parking/checkout
export const parkingCheckOut = async (req: Request, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { card_id } = req.params;
        const { license_plate } = req.body;

        if (!license_plate) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: 'Biển số xe là bắt buộc'
            });
        }

        const card = await Card.findOne({ card_id, is_active: true }).session(session);
        if (!card) {
            await session.abortTransaction();
            return res.status(404).json({
                status: 'error',
                message: 'Card not found or is inactive'
            });
        }

        if (card.license_plate !== license_plate) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: `Biển số xe không khớp. Biển số xe đã đăng ký là ${card.license_plate}.`
            });
        }

        // Tìm session đang active
        const activeSession = await ParkingSession.findOne({
            card: card._id,
            status: 'ACTIVE'
        }).session(session);

        if (!activeSession) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: 'Không tìm thấy phiên đỗ xe đang hoạt động cho thẻ này'
            });
        }

        // Tính toán thời gian và phí
        const timeOut = new Date();
        const timeIn = activeSession.timestamp_in;
        const durationMs = timeOut.getTime() - timeIn.getTime();
        const durationHours = Math.ceil(durationMs / (1000 * 60 * 60)); // Làm tròn lên giờ tiếp theo
        const parkingFee = -(durationHours * PARKING_FEE_PER_HOUR);

        // Kiểm tra số dư
        if (card.balance < Math.abs(parkingFee)) {
            await session.abortTransaction();
            return res.status(400).json({
                status: 'error',
                message: `Số dư không đủ. Cần ${Math.abs(parkingFee)} VNĐ, còn ${card.balance} VNĐ`,
                data: {
                    required_amount: Math.abs(parkingFee),
                    current_balance: card.balance,
                    shortage: Math.abs(parkingFee) - card.balance
                }
            });
        }

        // Cập nhật session
        activeSession.timestamp_out = timeOut;
        activeSession.status = 'COMPLETED';
        await activeSession.save({ session });

        // Trừ tiền
        card.balance += parkingFee;
        await card.save({ session });

        // Tạo transaction
        const transaction = new Transaction({
            card: card._id,
            type: 'PARKING',
            amount: parkingFee,
            description: `Gửi xe tại ${activeSession.location} - ${durationHours} giờ`,
            location: activeSession.location,
            timestamp_in: timeIn,
            timestamp_out: timeOut,
        });
        await transaction.save({ session });

        await session.commitTransaction();
        res.status(200).json({
            status: 'success',
            message: 'Check-out thành công. Đã trừ tiền gửi xe.',
            data: {
                session_id: activeSession._id,
                card_id: card.card_id,
                license_plate: card.license_plate,
                location: activeSession.location,
                timestamp_in: timeIn,
                timestamp_out: timeOut,
                parking_duration_hours: durationHours,
                parking_fee: Math.abs(parkingFee),
                previous_balance: card.balance - parkingFee,
                new_balance: card.balance,
                transaction_id: transaction.transaction_id
            }
        });
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ status: 'error', message: (error as Error).message });
    } finally {
        session.endSession();
    }
};

// ADMIN: GET /cards/{card_id}/parking/status
export const getParkingStatus = async (req: Request, res: Response) => {
    try {
        const { card_id } = req.params;

        const card = await Card.findOne({ card_id });
        if (!card) {
            return res.status(404).json({
                status: 'error',
                message: 'Card not found'
            });
        }

        const activeSession = await ParkingSession.findOne({
            card: card._id,
            status: 'ACTIVE'
        });

        if (!activeSession) {
            return res.status(200).json({
                status: 'success',
                message: 'Không có phiên đỗ xe nào đang hoạt động',
                data: {
                    card_id: card.card_id,
                    has_active_session: false,
                    current_balance: card.balance
                }
            });
        }

        // Tính toán thời gian và phí dự kiến
        const now = new Date();
        const durationMs = now.getTime() - activeSession.timestamp_in.getTime();
        const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
        const estimatedFee = durationHours * PARKING_FEE_PER_HOUR;

        res.status(200).json({
            status: 'success',
            data: {
                card_id: card.card_id,
                has_active_session: true,
                session_id: activeSession._id,
                location: activeSession.location,
                timestamp_in: activeSession.timestamp_in,
                current_duration_hours: durationHours,
                estimated_fee: estimatedFee,
                current_balance: card.balance,
                sufficient_balance: card.balance >= estimatedFee
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: (error as Error).message });
    }
};

// ADMIN: GET /cards/{card_id}/history
export const getCardHistoryForAdmin = async (req: Request, res: Response) => {
    try {
        const { type } = req.query;
        const card = await Card.findOne({ card_id: req.params.card_id });
        if (!card) {
            return res.status(404).json({ status: 'error', message: 'Card not found' });
        }

        const query: any = { card: card._id };
        if (type && (type === 'PARKING' || type === 'RECHARGE')) {
            query.type = type;
        }

        const transactions = await Transaction.find(query).sort({ timestamp: -1 });
        res.status(200).json({
            status: 'success',
            card_id: card.card_id,
            data: transactions,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: (error as Error).message });
    }
};