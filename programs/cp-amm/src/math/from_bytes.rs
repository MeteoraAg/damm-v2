pub trait FromBytesExt: Sized {
    fn from_bytes(bytes: &[u8]) -> Self;
}

impl FromBytesExt for u32 {
    fn from_bytes(bytes: &[u8]) -> Self {
        let mut arr = [0u8; 4];
        arr.copy_from_slice(bytes);
        u32::from_le_bytes(arr)
    }
}

impl FromBytesExt for u64 {
    fn from_bytes(bytes: &[u8]) -> Self {
        let mut arr = [0u8; 8];
        arr.copy_from_slice(bytes);
        u64::from_le_bytes(arr)
    }
}

impl FromBytesExt for u16 {
    fn from_bytes(bytes: &[u8]) -> Self {
        let mut arr = [0u8; 2];
        arr.copy_from_slice(bytes);
        u16::from_le_bytes(arr)
    }
}
