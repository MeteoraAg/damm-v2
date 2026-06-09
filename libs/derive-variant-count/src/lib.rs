extern crate proc_macro;

use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput};

#[proc_macro_derive(VariantCount)]
pub fn derive_variant_count(input: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    let count = match &input.data {
        Data::Struct(data_struct) => data_struct.fields.len(),
        Data::Enum(data_enum) => data_enum.variants.len(),
        Data::Union(_) => {
            return syn::Error::new_spanned(name, "unions are not supported")
                .to_compile_error()
                .into();
        }
    };

    quote! {
        impl #impl_generics #name #ty_generics #where_clause {
            pub const VARIANT_COUNT: usize = #count;
        }
    }
    .into()
}
