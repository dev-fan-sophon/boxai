package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// r2Store is an S3-compatible object store backed by Cloudflare R2.
type r2Store struct {
	client     *s3.Client
	presign    *s3.PresignClient
	bucket     string
	publicBase string
	presignTTL time.Duration
}

func newR2Store() (*r2Store, error) {
	endpoint := strings.TrimSpace(common.GetEnvOrDefaultString("R2_ENDPOINT", ""))
	bucket := strings.TrimSpace(common.GetEnvOrDefaultString("R2_BUCKET", ""))
	accessKey := strings.TrimSpace(common.GetEnvOrDefaultString("R2_ACCESS_KEY_ID", ""))
	secretKey := strings.TrimSpace(common.GetEnvOrDefaultString("R2_SECRET_ACCESS_KEY", ""))
	if endpoint == "" || bucket == "" || accessKey == "" || secretKey == "" {
		return nil, errors.New("r2: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required")
	}

	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(endpoint),
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		// R2 rejects the default aws-chunked trailing checksums; only send when required.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})

	ttl := time.Duration(common.GetEnvOrDefault("R2_PRESIGN_TTL", 600)) * time.Second
	if ttl <= 0 {
		ttl = 600 * time.Second
	}

	return &r2Store{
		client:     client,
		presign:    s3.NewPresignClient(client),
		bucket:     bucket,
		publicBase: strings.TrimRight(common.GetEnvOrDefaultString("R2_PUBLIC_BASE_URL", ""), "/"),
		presignTTL: ttl,
	}, nil
}

func (s *r2Store) Backend() string { return "r2" }

func (s *r2Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	clean, err := cleanKey(key)
	if err != nil {
		return err
	}
	body, length, err := seekableBody(r, size)
	if err != nil {
		return err
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(clean),
		Body:   body,
	}
	if length >= 0 {
		in.ContentLength = aws.Int64(length)
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	_, err = s.client.PutObject(ctx, in)
	return err
}

func (s *r2Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	clean, err := cleanKey(key)
	if err != nil {
		return nil, err
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(clean),
	})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

func (s *r2Store) Delete(ctx context.Context, key string) error {
	clean, err := cleanKey(key)
	if err != nil {
		return err
	}
	_, err = s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(clean),
	})
	return err
}

func (s *r2Store) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	clean, err := cleanKey(key)
	if err != nil {
		return "", err
	}
	if ttl <= 0 {
		ttl = s.presignTTL
	}
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(clean),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *r2Store) PublicURL(key string) (string, bool) {
	clean, err := cleanKey(key)
	if err != nil {
		return "", false
	}
	if s.publicBase == "" || !IsPublicKey(clean) {
		return "", false
	}
	return fmt.Sprintf("%s/%s", s.publicBase, clean), true
}

// seekableBody returns a seekable reader and its length. When size is unknown
// and r is not already seekable, it buffers the (size-bounded) content so the
// S3 client can compute signatures.
func seekableBody(r io.Reader, size int64) (io.ReadSeeker, int64, error) {
	if rs, ok := r.(io.ReadSeeker); ok {
		return rs, size, nil
	}
	buf, err := io.ReadAll(r)
	if err != nil {
		return nil, 0, err
	}
	return bytes.NewReader(buf), int64(len(buf)), nil
}
